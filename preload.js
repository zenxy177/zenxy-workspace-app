const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    startServer: (port) => ipcRenderer.invoke('server:start', port),
    stopServer: () => ipcRenderer.invoke('server:stop'),
    getServerStatus: () => ipcRenderer.invoke('server:getStatus'),
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    getSharedFolder: () => ipcRenderer.invoke('config:getSharedFolder'),
    setSharedFolder: (folderPath) => ipcRenderer.invoke('config:setSharedFolder', folderPath),
    isElectron: true
});
