const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const Database = require('./src/server/db');
const VDSServer = require('./src/server/server');

let mainWindow = null;
let embeddedServer = null;
let localDb = null;

function getUserDataPath() {
    return app.isPackaged ? app.getPath('userData') : null;
}

function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }
    return addresses;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1360,
        height: 860,
        minWidth: 1024,
        minHeight: 700,
        frame: false,
        backgroundColor: '#06080d',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        },
        icon: path.join(__dirname, 'assets/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'src/client/index.html'));

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    localDb = new Database(getUserDataPath());
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', async () => {
    if (embeddedServer && embeddedServer.isRunning) {
        await embeddedServer.stop();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

/* -------------------------------------------------------------
 * IPC HANDLERS
 * ----------------------------------------------------------- */
ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('server:start', async (event, port) => {
    try {
        if (!embeddedServer) {
            embeddedServer = new VDSServer(getUserDataPath());
        }
        const activePort = await embeddedServer.start(port);
        return {
            success: true,
            port: activePort,
            localIps: getLocalIpAddresses()
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('server:stop', async () => {
    try {
        if (embeddedServer) {
            await embeddedServer.stop();
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('server:getStatus', () => {
    return {
        isRunning: embeddedServer ? embeddedServer.isRunning : false,
        port: embeddedServer ? embeddedServer.port : 8899,
        localIps: getLocalIpAddresses()
    };
});

ipcMain.handle('dialog:selectFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Paylaşılacak VDS Klasörünü Seçin'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const selected = result.filePaths[0];
        localDb.setSharedFolder(selected);
        if (embeddedServer && embeddedServer.db) {
            embeddedServer.db.setSharedFolder(selected);
        }
        return selected;
    }
    return null;
});

ipcMain.handle('config:getSharedFolder', () => {
    const config = localDb.getConfig();
    return config.sharedRoots?.[0]?.path || path.resolve(process.cwd(), 'shared_workspace');
});

ipcMain.handle('config:setSharedFolder', (event, folderPath) => {
    const root = localDb.setSharedFolder(folderPath);
    if (embeddedServer && embeddedServer.db) {
        embeddedServer.db.setSharedFolder(folderPath);
    }
    return root.path;
});
