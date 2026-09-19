const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class Database {
    constructor(dataDir = null) {
        if (dataDir) {
            this.dataDir = path.join(dataDir, 'data');
            this.workspaceDir = path.join(dataDir, 'shared_workspace');
        } else {
            this.dataDir = path.join(process.cwd(), 'data');
            this.workspaceDir = path.join(process.cwd(), 'shared_workspace');
        }
        this.configPath = path.join(this.dataDir, 'config.json');
        this.usersPath = path.join(this.dataDir, 'users.json');
        this.logsPath = path.join(this.dataDir, 'logs.json');
        
        this.ensureDirectories();
        this.initDefaults();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.workspaceDir)) {
            fs.mkdirSync(this.workspaceDir, { recursive: true });
        }
    }

    atomicWrite(filePath, data) {
        const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    }

    readJson(filePath, defaultValue) {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (err) {
            console.error(`Error reading ${filePath}:`, err);
        }
        return defaultValue;
    }

    initDefaults() {
        if (!fs.existsSync(this.configPath)) {
            const defaultConfig = {
                port: 8899,
                jwtSecret: crypto.randomBytes(32).toString('hex'),
                sharedRoots: [
                    {
                        id: 'default',
                        name: 'Ana Paylaşım Alanı',
                        path: path.resolve(this.workspaceDir)
                    }
                ],
                security: {
                    maxLoginAttempts: 5,
                    lockoutMinutes: 15,
                    sessionTimeoutMinutes: 1440,
                    requireSecurePassword: true
                }
            };
            this.atomicWrite(this.configPath, defaultConfig);
        }

        if (!fs.existsSync(this.usersPath)) {
            const adminSalt = bcrypt.genSaltSync(10);
            const defaultUsers = [
                {
                    id: 'usr_admin',
                    username: 'admin',
                    passwordHash: bcrypt.hashSync('Admin123!@#', adminSalt),
                    displayName: 'VDS Yöneticisi',
                    role: 'admin',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    permissions: {
                        allFolders: true,
                        allowedFolders: [],
                        canRead: true,
                        canWrite: true,
                        canDelete: true,
                        canTerminal: true,
                        canViewLogs: true
                    }
                }
            ];
            this.atomicWrite(this.usersPath, defaultUsers);
        }

        if (!fs.existsSync(this.logsPath)) {
            this.atomicWrite(this.logsPath, []);
        }
    }

    getConfig() {
        return this.readJson(this.configPath, {});
    }

    updateConfig(newConfig) {
        const current = this.getConfig();
        const updated = { ...current, ...newConfig };
        this.atomicWrite(this.configPath, updated);
        return updated;
    }

    setSharedFolder(folderPath) {
        const cleanPath = path.resolve(folderPath);
        if (!fs.existsSync(cleanPath)) {
            fs.mkdirSync(cleanPath, { recursive: true });
        }
        const current = this.getConfig();
        current.sharedRoots = [
            {
                id: 'default',
                name: path.basename(cleanPath) || 'Paylaşılan Klasör',
                path: cleanPath
            }
        ];
        this.atomicWrite(this.configPath, current);
        return current.sharedRoots[0];
    }

    getUsers() {
        return this.readJson(this.usersPath, []);
    }

    getUserByUsername(username) {
        const users = this.getUsers();
        return users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    getUserById(id) {
        const users = this.getUsers();
        return users.find(u => u.id === id);
    }

    createUser({ username, password, displayName, permissions, role = 'member' }) {
        const users = this.getUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Bu kullanıcı adı zaten kullanılıyor.');
        }

        const salt = bcrypt.genSaltSync(10);
        const newUser = {
            id: 'usr_' + crypto.randomBytes(6).toString('hex'),
            username: username.trim(),
            passwordHash: bcrypt.hashSync(password, salt),
            displayName: displayName ? displayName.trim() : username.trim(),
            role,
            status: 'active',
            createdAt: new Date().toISOString(),
            permissions: {
                allFolders: permissions?.allFolders ?? false,
                allowedFolders: permissions?.allowedFolders ?? [],
                canRead: permissions?.canRead ?? true,
                canWrite: permissions?.canWrite ?? false,
                canDelete: permissions?.canDelete ?? false,
                canTerminal: permissions?.canTerminal ?? false,
                canViewLogs: permissions?.canViewLogs ?? false
            }
        };

        users.push(newUser);
        this.atomicWrite(this.usersPath, users);
        return this.sanitizeUser(newUser);
    }

    updateUser(id, updates) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.id === id);
        if (index === -1) throw new Error('Kullanıcı bulunamadı.');

        const user = users[index];

        if (updates.password && updates.password.trim().length > 0) {
            const salt = bcrypt.genSaltSync(10);
            user.passwordHash = bcrypt.hashSync(updates.password, salt);
        }

        if (updates.displayName) user.displayName = updates.displayName.trim();
        if (updates.status) user.status = updates.status;
        if (updates.role && user.role !== 'admin') user.role = updates.role;
        
        if (updates.permissions) {
            user.permissions = {
                ...user.permissions,
                ...updates.permissions
            };
        }

        users[index] = user;
        this.atomicWrite(this.usersPath, users);
        return this.sanitizeUser(user);
    }

    deleteUser(id) {
        const users = this.getUsers();
        const user = users.find(u => u.id === id);
        if (!user) throw new Error('Kullanıcı bulunamadı.');
        if (user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
            throw new Error('Son yönetici hesabı silinemez.');
        }

        const filtered = users.filter(u => u.id !== id);
        this.atomicWrite(this.usersPath, filtered);
        return true;
    }

    sanitizeUser(user) {
        if (!user) return null;
        const { passwordHash, ...safeUser } = user;
        return safeUser;
    }

    getLogs(limit = 500) {
        const logs = this.readJson(this.logsPath, []);
        return logs.slice(-limit).reverse();
    }

    appendLog(logEntry) {
        const logs = this.readJson(this.logsPath, []);
        const entry = {
            id: 'log_' + crypto.randomBytes(6).toString('hex'),
            timestamp: new Date().toISOString(),
            ...logEntry
        };
        logs.push(entry);
        const trimmed = logs.slice(-5000);
        this.atomicWrite(this.logsPath, trimmed);
        return entry;
    }
}

module.exports = Database;
