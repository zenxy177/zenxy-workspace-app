const EventEmitter = require('events');

class AuditLogger extends EventEmitter {
    constructor(db) {
        super();
        this.db = db;
    }

    /**
     * Records a secure log entry and broadcasts it to permitted listeners
     */
    log({ username, ip, action, target, details, status = 'SUCCESS' }) {
        const entry = this.db.appendLog({
            username: username || 'System',
            ip: ip || '127.0.0.1',
            action,
            target: target || '-',
            details: details || '',
            status
        });

        // Broadcast to listeners (Host UI or WebSocket clients)
        this.emit('log', entry);
        return entry;
    }

    getLogs(limit = 500) {
        return this.db.getLogs(limit);
    }
}

module.exports = AuditLogger;
