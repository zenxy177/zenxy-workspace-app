const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const crypto = require('crypto');

const Database = require('./db');
const SecurityEngine = require('./security');
const AuditLogger = require('./audit-logger');
const AuthManager = require('./auth');
const FileService = require('./file-service');
const TerminalService = require('./terminal-service');
const LiveCollaborationHub = require('./live-collab');

class VDSServer {
    constructor(customDataDir = null) {
        this.db = new Database(customDataDir);
        this.security = new SecurityEngine(this.db);
        this.auditLogger = new AuditLogger(this.db);
        this.auth = new AuthManager(this.db, this.auditLogger);
        this.fileService = new FileService(this.db, this.security, this.auditLogger);
        this.terminalService = new TerminalService(this.db, this.security, this.auditLogger);
        this.collabHub = new LiveCollaborationHub(this.auditLogger);

        this.app = express();
        this.httpServer = null;
        this.wss = null;
        this.apiRateLimiter = new SecurityEngine.RateLimiter(60000, 200); // 200 req / min per IP
        this.authRateLimiter = new SecurityEngine.RateLimiter(60000, 20); // 20 login attempts / min per IP
        this.wsConnectionsPerIp = new Map();

        this.setupExpress();
    }

    setupExpress() {
        this.app.use(cors({ origin: true, credentials: true }));
        this.app.use(express.json({ limit: '100mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '100mb' }));

        this.app.use('/client', express.static(path.join(__dirname, '../client')));

        const upload = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: 500 * 1024 * 1024 }
        });

        const getIp = (req) => {
            const forwarded = req.headers['x-forwarded-for'];
            if (forwarded) return forwarded.split(',')[0].trim();
            return req.socket.remoteAddress || '127.0.0.1';
        };

        // Layer-7 Anti-DoS / Rate Limiter Middleware
        this.app.use('/api', (req, res, next) => {
            const ip = getIp(req);
            if (!this.apiRateLimiter.isAllowed(ip)) {
                return res.status(429).json({
                    success: false,
                    error: 'Aşırı istek algılandı (Rate Limit)! Lütfen biraz bekleyin.'
                });
            }
            next();
        });

        /* -------------------------------------------------------------
         * AUTH ENDPOINTS
         * ----------------------------------------------------------- */
        this.app.post('/api/auth/login', async (req, res) => {
            const { username, password } = req.body;
            const ip = getIp(req);
            const userAgent = req.headers['user-agent'];

            if (!this.authRateLimiter.isAllowed(ip)) {
                return res.status(429).json({
                    success: false,
                    error: 'Çok fazla giriş denemesi yapıldı. Lütfen 1 dakika sonra tekrar deneyin.'
                });
            }

            if (!username || !password) {
                return res.status(400).json({ success: false, error: 'Kullanıcı adı ve şifre gereklidir.' });
            }

            try {
                const result = await this.auth.login(username, password, ip, userAgent);
                res.json({ success: true, ...result });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/auth/logout', this.auth.authMiddleware(), (req, res) => {
            this.auth.logout(req.token);
            res.json({ success: true, message: 'Başarıyla çıkış yapıldı.' });
        });

        this.app.get('/api/auth/me', this.auth.authMiddleware(), (req, res) => {
            res.json({
                success: true,
                user: this.db.sanitizeUser(req.user),
                serverInfo: {
                    hostname: os.hostname(),
                    platform: os.platform(),
                    uptime: process.uptime()
                }
            });
        });

        /* -------------------------------------------------------------
         * FILE SYSTEM ENDPOINTS
         * ----------------------------------------------------------- */
        this.app.get('/api/files/roots', this.auth.authMiddleware(), (req, res) => {
            const config = this.db.getConfig();
            const roots = (config.sharedRoots || []).map(r => ({
                id: r.id,
                name: r.name,
                path: req.user.role === 'admin' ? r.path : undefined
            }));
            res.json({ success: true, roots });
        });

        this.app.get('/api/files/list', this.auth.authMiddleware(), async (req, res) => {
            const rootId = req.query.rootId || 'default';
            const relPath = req.query.path || '';
            const ip = getIp(req);

            try {
                const data = await this.fileService.listDirectory(rootId, relPath, req.user, ip);
                res.json({ success: true, ...data });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/files/read', this.auth.authMiddleware(), async (req, res) => {
            const rootId = req.query.rootId || 'default';
            const relPath = req.query.path || '';
            const ip = getIp(req);

            try {
                const fileData = await this.fileService.readFile(rootId, relPath, req.user, ip);
                res.json({ success: true, ...fileData });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/files/download', this.auth.authMiddleware(), (req, res) => {
            const rootId = req.query.rootId || 'default';
            const relPath = req.query.path || '';
            const ip = getIp(req);

            try {
                const fullPath = this.security.resolveSafePath(rootId, relPath, req.user, 'canRead');
                if (!fs.existsSync(fullPath)) {
                    return res.status(404).json({ success: false, error: 'Dosya bulunamadı.' });
                }

                this.auditLogger.log({
                    username: req.user.username,
                    ip,
                    action: 'FILE_DOWNLOAD',
                    target: relPath,
                    details: 'Dosya indirildi.'
                });

                res.download(fullPath, path.basename(fullPath));
            } catch (err) {
                res.status(403).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/files/write', this.auth.authMiddleware(), async (req, res) => {
            const { rootId = 'default', path: relPath, content } = req.body;
            const ip = getIp(req);

            if (!relPath) {
                return res.status(400).json({ success: false, error: 'Dosya yolu belirtilmedi.' });
            }

            try {
                const result = await this.fileService.writeFile(rootId, relPath, content || '', req.user, ip);
                res.json({ success: true, ...result });
            } catch (err) {
                res.status(403).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/files/create-folder', this.auth.authMiddleware(), async (req, res) => {
            const { rootId = 'default', path: relPath } = req.body;
            const ip = getIp(req);

            if (!relPath) {
                return res.status(400).json({ success: false, error: 'Klasör yolu belirtilmedi.' });
            }

            try {
                await this.fileService.createDirectory(rootId, relPath, req.user, ip);
                res.json({ success: true, message: 'Klasör oluşturuldu.' });
            } catch (err) {
                res.status(403).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/files/delete', this.auth.authMiddleware(), async (req, res) => {
            const { rootId = 'default', path: relPath } = req.body;
            const ip = getIp(req);

            if (!relPath) {
                return res.status(400).json({ success: false, error: 'Silinecek yol belirtilmedi.' });
            }

            try {
                await this.fileService.deleteItem(rootId, relPath, req.user, ip);
                res.json({ success: true, message: 'Öğe başarıyla silindi.' });
            } catch (err) {
                res.status(403).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/files/rename', this.auth.authMiddleware(), async (req, res) => {
            const { rootId = 'default', oldPath, newPath } = req.body;
            const ip = getIp(req);

            if (!oldPath || !newPath) {
                return res.status(400).json({ success: false, error: 'Eski ve yeni yollar belirtilmelidir.' });
            }

            try {
                await this.fileService.renameItem(rootId, oldPath, newPath, req.user, ip);
                res.json({ success: true, message: 'Başarıyla yeniden adlandırıldı.' });
            } catch (err) {
                res.status(403).json({ success: false, error: err.message });
            }
        });

        // Fixed & robust upload handler
        this.app.post('/api/files/upload', this.auth.authMiddleware(), upload.array('files'), async (req, res) => {
            const rootId = req.body.rootId || 'default';
            const targetFolder = req.body.folder || '';
            const ip = getIp(req);

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, error: 'Yüklenecek dosya seçilmedi.' });
            }

            try {
                const uploaded = [];
                for (const file of req.files) {
                    const safeName = this.security.sanitizeFilename(file.originalname);
                    const relFilePath = path.posix.join((targetFolder || '').replace(/\\/g, '/'), safeName);
                    const fullPath = this.security.resolveSafePath(rootId, relFilePath, req.user, 'canWrite');

                    const parentDir = path.dirname(fullPath);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }

                    fs.writeFileSync(fullPath, file.buffer);
                    uploaded.push({ name: safeName, size: file.size });

                    this.auditLogger.log({
                        username: req.user.username,
                        ip,
                        action: 'FILE_UPLOAD',
                        target: relFilePath,
                        details: `Dosya yüklendi (${(file.size / 1024).toFixed(1)} KB)`
                    });
                }

                res.json({ success: true, uploaded });
            } catch (err) {
                console.error('File Upload Error:', err);
                res.status(403).json({ success: false, error: err.message });
            }
        });

        /* -------------------------------------------------------------
         * ADMIN & SHARED FOLDER SELECTION ENDPOINTS
         * ----------------------------------------------------------- */
        const requireAdmin = (req, res, next) => {
            if (req.user.role !== 'admin') {
                return res.status(403).json({ success: false, error: 'Bu işlem yalnızca VDS Yöneticisi için geçerlidir.' });
            }
            next();
        };

        this.app.get('/api/admin/shared-folder', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            const config = this.db.getConfig();
            const root = config.sharedRoots?.[0] || { path: path.resolve(process.cwd(), 'shared_workspace'), name: 'Varsayılan' };
            res.json({ success: true, sharedFolder: root });
        });

        this.app.post('/api/admin/shared-folder', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            const { folderPath } = req.body;
            if (!folderPath) {
                return res.status(400).json({ success: false, error: 'Klasör yolu belirtilmedi.' });
            }

            try {
                const root = this.db.setSharedFolder(folderPath);
                this.auditLogger.log({
                    username: req.user.username,
                    ip: getIp(req),
                    action: 'CONFIG_SHARED_FOLDER',
                    target: folderPath,
                    details: 'Paylaşılan çalışma klasörü değiştirildi.'
                });
                res.json({ success: true, sharedFolder: root });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/logs', this.auth.authMiddleware(), (req, res) => {
            if (!this.security.checkPermission(req.user, 'canViewLogs')) {
                return res.status(403).json({ success: false, error: 'Logları görme yetkiniz yok.' });
            }

            const limit = parseInt(req.query.limit || '200', 10);
            const logs = this.auditLogger.getLogs(limit);
            res.json({ success: true, logs });
        });

        this.app.get('/api/admin/users', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            const users = this.db.getUsers().map(u => this.db.sanitizeUser(u));
            res.json({ success: true, users });
        });

        this.app.post('/api/admin/users/create', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            try {
                const user = this.db.createUser(req.body);
                this.auditLogger.log({
                    username: req.user.username,
                    ip: getIp(req),
                    action: 'USER_CREATED',
                    target: user.username,
                    details: 'Yeni kullanıcı oluşturuldu.'
                });
                res.json({ success: true, user });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/admin/users/update/:id', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            try {
                const user = this.db.updateUser(req.params.id, req.body);
                this.auditLogger.log({
                    username: req.user.username,
                    ip: getIp(req),
                    action: 'USER_UPDATED',
                    target: user.username,
                    details: 'Kullanıcı izinleri/bilgileri güncellendi.'
                });
                res.json({ success: true, user });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/admin/users/delete/:id', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            try {
                this.auth.kickUser(req.params.id);
                this.db.deleteUser(req.params.id);
                this.auditLogger.log({
                    username: req.user.username,
                    ip: getIp(req),
                    action: 'USER_DELETED',
                    target: req.params.id,
                    details: 'Kullanıcı hesabı silindi.'
                });
                res.json({ success: true, message: 'Kullanıcı silindi.' });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        this.app.get('/api/admin/sessions', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            const sessions = this.auth.getActiveSessions();
            res.json({ success: true, sessions });
        });

        this.app.post('/api/admin/sessions/kick', this.auth.authMiddleware(), requireAdmin, (req, res) => {
            const { userId } = req.body;
            const kicked = this.auth.kickUser(userId);
            res.json({ success: true, count: kicked });
        });

        this.app.get('/api/admin/system-stats', this.auth.authMiddleware(), (req, res) => {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            res.json({
                success: true,
                stats: {
                    hostname: os.hostname(),
                    platform: os.platform(),
                    arch: os.arch(),
                    cpus: os.cpus().length,
                    cpuModel: os.cpus()[0]?.model || 'N/A',
                    memory: {
                        totalMB: Math.round(totalMem / (1024 * 1024)),
                        usedMB: Math.round(usedMem / (1024 * 1024)),
                        percent: Math.round((usedMem / totalMem) * 100)
                    },
                    uptimeSeconds: os.uptime(),
                    activeSessionsCount: this.auth.getActiveSessions().length
                }
            });
        });
    }

    setupWebSockets() {
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws, req) => {
            const socketId = 'sock_' + crypto.randomBytes(6).toString('hex');
            let authenticatedUser = null;
            let clientIp = req.socket.remoteAddress || '127.0.0.1';

            // Anti-Socket Flood: max 25 concurrent connections per IP
            const currentCount = (this.wsConnectionsPerIp.get(clientIp) || 0) + 1;
            if (currentCount > 25) {
                ws.send(JSON.stringify({ type: 'error', error: 'Çok fazla eşzamanlı soket bağlantısı.' }));
                ws.close();
                return;
            }
            this.wsConnectionsPerIp.set(clientIp, currentCount);

            ws.on('message', (messageRaw) => {
                let msg;
                try {
                    msg = JSON.parse(messageRaw);
                } catch {
                    return;
                }

                if (msg.type === 'auth') {
                    const user = this.auth.verifyWsToken(msg.token);
                    if (!user) {
                        ws.send(JSON.stringify({ type: 'auth:error', error: 'Geçersiz oturum.' }));
                        ws.close();
                        return;
                    }
                    authenticatedUser = user;
                    ws.send(JSON.stringify({ type: 'auth:success', user: this.db.sanitizeUser(user) }));
                    return;
                }

                if (!authenticatedUser) {
                    ws.send(JSON.stringify({ type: 'error', error: 'Önce kimlik doğrulanmalıdır.' }));
                    return;
                }

                if (msg.type === 'terminal:start') {
                    this.terminalService.createSession(socketId, ws, authenticatedUser, clientIp);
                } else if (msg.type === 'terminal:input') {
                    this.terminalService.handleInput(socketId, msg.data);
                } else if (msg.type === 'terminal:close') {
                    this.terminalService.closeSession(socketId);
                } else if (msg.type === 'collab:join_file') {
                    this.collabHub.joinFile(socketId, ws, authenticatedUser, msg.rootId || 'default', msg.path);
                } else if (msg.type === 'collab:cursor') {
                    this.collabHub.handleCursorMove(socketId, msg.position, msg.selection);
                } else if (msg.type === 'collab:edit') {
                    this.collabHub.handleFileEdit(socketId, msg.change);
                } else if (msg.type === 'collab:leave_file') {
                    this.collabHub.leaveFile(socketId);
                }
            });

            const logHandler = (entry) => {
                if (authenticatedUser && (authenticatedUser.role === 'admin' || authenticatedUser.permissions?.canViewLogs)) {
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: 'log:stream', entry }));
                    }
                }
            };
            this.auditLogger.on('log', logHandler);

            ws.on('close', () => {
                const count = this.wsConnectionsPerIp.get(clientIp) || 1;
                if (count <= 1) {
                    this.wsConnectionsPerIp.delete(clientIp);
                } else {
                    this.wsConnectionsPerIp.set(clientIp, count - 1);
                }

                this.auditLogger.off('log', logHandler);
                this.terminalService.closeSession(socketId);
                this.collabHub.leaveFile(socketId);
            });
        });
    }

    start(port = null) {
        if (this.isRunning) return Promise.resolve(this.port);

        this.port = port || this.port || 8899;
        this.httpServer = http.createServer(this.app);
        this.setupWebSockets();

        return new Promise((resolve, reject) => {
            this.httpServer.listen(this.port, '0.0.0.0', () => {
                this.isRunning = true;
                this.auditLogger.log({
                    username: 'System',
                    ip: '127.0.0.1',
                    action: 'SERVER_START',
                    details: `VDS Sunucusu port ${this.port} üzerinde başlatıldı.`
                });
                console.log(`[VDS Server] Running on http://0.0.0.0:${this.port}`);
                resolve(this.port);
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    stop() {
        if (!this.isRunning || !this.httpServer) return Promise.resolve();

        return new Promise((resolve) => {
            if (this.wss) {
                this.wss.close();
            }
            this.httpServer.close(() => {
                this.isRunning = false;
                this.auditLogger.log({
                    username: 'System',
                    ip: '127.0.0.1',
                    action: 'SERVER_STOP',
                    details: 'VDS Sunucusu durduruldu.'
                });
                console.log('[VDS Server] Stopped.');
                resolve();
            });
        });
    }
}

module.exports = VDSServer;
