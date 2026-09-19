const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

class AuthManager {
    constructor(db, auditLogger) {
        this.db = db;
        this.auditLogger = auditLogger;
        this.failedAttempts = new Map(); // IP -> { count, lockedUntil }
        this.activeSessions = new Map(); // token -> { userId, ip, userAgent, lastSeen }
    }

    isIpLocked(ip) {
        const record = this.failedAttempts.get(ip);
        if (!record) return false;
        if (record.lockedUntil && record.lockedUntil > Date.now()) {
            return true;
        }
        if (record.lockedUntil && record.lockedUntil <= Date.now()) {
            this.failedAttempts.delete(ip);
            return false;
        }
        return false;
    }

    recordFailedAttempt(ip, username) {
        const config = this.db.getConfig();
        const maxAttempts = config.security?.maxLoginAttempts || 5;
        const lockoutMinutes = config.security?.lockoutMinutes || 15;

        let record = this.failedAttempts.get(ip) || { count: 0, lockedUntil: null };
        record.count += 1;

        if (record.count >= maxAttempts) {
            record.lockedUntil = Date.now() + lockoutMinutes * 60 * 1000;
            this.auditLogger.log({
                username: username || 'Unknown',
                ip,
                action: 'AUTH_IP_LOCKED',
                details: `IP ${lockoutMinutes} dakika boyunca engellendi (${maxAttempts} başarısız deneme).`,
                status: 'BLOCKED'
            });
        }

        this.failedAttempts.set(ip, record);
    }

    clearFailedAttempts(ip) {
        this.failedAttempts.delete(ip);
    }

    async login(username, password, ip, userAgent) {
        if (this.isIpLocked(ip)) {
            const record = this.failedAttempts.get(ip);
            const remainingMinutes = Math.ceil((record.lockedUntil - Date.now()) / 60000);
            throw new Error(`Çok fazla hatalı giriş denemesi. IP adresiniz ${remainingMinutes} dakika engellendi.`);
        }

        const user = this.db.getUserByUsername(username);
        if (!user || user.status !== 'active') {
            this.recordFailedAttempt(ip, username);
            this.auditLogger.log({
                username,
                ip,
                action: 'AUTH_LOGIN_FAILED',
                details: 'Geçersiz kullanıcı adı veya pasif hesap.',
                status: 'FAILED'
            });
            throw new Error('Kullanıcı adı veya şifre hatalı.');
        }

        const isMatch = bcrypt.compareSync(password, user.passwordHash);
        if (!isMatch) {
            this.recordFailedAttempt(ip, username);
            this.auditLogger.log({
                username,
                ip,
                action: 'AUTH_LOGIN_FAILED',
                details: 'Hatalı şifre girildi.',
                status: 'FAILED'
            });
            throw new Error('Kullanıcı adı veya şifre hatalı.');
        }

        this.clearFailedAttempts(ip);
        const config = this.db.getConfig();
        const expiresIn = `${config.security?.sessionTimeoutMinutes || 1440}m`;

        const tokenPayload = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn });

        this.activeSessions.set(token, {
            token,
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            ip,
            userAgent: userAgent || 'Unknown',
            loginTime: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        });

        this.auditLogger.log({
            username: user.username,
            ip,
            action: 'AUTH_LOGIN_SUCCESS',
            details: `Kullanıcı başarıyla giriş yaptı (${user.role}).`,
            status: 'SUCCESS'
        });

        return {
            token,
            user: this.db.sanitizeUser(user)
        };
    }

    logout(token) {
        if (this.activeSessions.has(token)) {
            const session = this.activeSessions.get(token);
            this.auditLogger.log({
                username: session.username,
                ip: session.ip,
                action: 'AUTH_LOGOUT',
                details: 'Oturum kapatıldı.',
                status: 'SUCCESS'
            });
            this.activeSessions.delete(token);
        }
    }

    kickUser(userId) {
        let count = 0;
        for (const [token, session] of this.activeSessions.entries()) {
            if (session.userId === userId) {
                this.activeSessions.delete(token);
                count++;
            }
        }
        return count;
    }

    getActiveSessions() {
        return Array.from(this.activeSessions.values());
    }

    authMiddleware() {
        return (req, res, next) => {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token;

            if (!token) {
                return res.status(401).json({ success: false, error: 'Oturum bulunamadı. Lütfen giriş yapın.' });
            }

            const config = this.db.getConfig();
            try {
                // Verify cryptographic signature and expiration
                const decoded = jwt.verify(token, config.jwtSecret);
                const freshUser = this.db.getUserById(decoded.id);

                if (!freshUser || freshUser.status !== 'active') {
                    this.activeSessions.delete(token);
                    return res.status(401).json({ success: false, error: 'Hesabınız aktif değil veya silinmiş.' });
                }

                // Restore/Update session state seamlessly
                let session = this.activeSessions.get(token);
                if (!session) {
                    session = {
                        token,
                        userId: freshUser.id,
                        username: freshUser.username,
                        displayName: freshUser.displayName,
                        role: freshUser.role,
                        ip: req.socket?.remoteAddress || '127.0.0.1',
                        userAgent: req.headers['user-agent'] || 'Unknown',
                        loginTime: new Date().toISOString(),
                        lastSeen: new Date().toISOString()
                    };
                    this.activeSessions.set(token, session);
                } else {
                    session.lastSeen = new Date().toISOString();
                }

                req.user = freshUser;
                req.sessionInfo = session;
                req.token = token;
                next();
            } catch (err) {
                this.activeSessions.delete(token);
                return res.status(401).json({ success: false, error: 'Oturum süresi dolmuş veya geçersiz. Lütfen tekrar giriş yapın.' });
            }
        };
    }

    verifyWsToken(token) {
        if (!token) return null;
        const config = this.db.getConfig();
        try {
            const decoded = jwt.verify(token, config.jwtSecret);
            const user = this.db.getUserById(decoded.id);
            if (!user || user.status !== 'active') return null;
            return user;
        } catch {
            return null;
        }
    }
}

module.exports = AuthManager;
