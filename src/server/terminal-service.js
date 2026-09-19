const { spawn } = require('child_process');
const path = require('path');

class TerminalService {
    constructor(db, securityEngine, auditLogger) {
        this.db = db;
        this.security = securityEngine;
        this.auditLogger = auditLogger;
        this.sessions = new Map(); // sessionId -> { process, user, ip, currentBuffer }
    }

    /**
     * Start a new interactive shell session for a WebSocket connection
     */
    createSession(sessionId, ws, user, ip) {
        if (!this.security.checkPermission(user, 'canTerminal')) {
            ws.send(JSON.stringify({
                type: 'terminal:error',
                error: 'Yetkisiz Erişim: Terminal kullanma izniniz yok.'
            }));
            ws.close();
            return;
        }

        const config = this.db.getConfig();
        const roots = config.sharedRoots || [];
        const initialCwd = (roots[0] && roots[0].path) ? path.resolve(roots[0].path) : process.cwd();

        const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
        const shellArgs = process.platform === 'win32' ? ['-NoLogo', '-NoExit'] : [];

        try {
            const termProcess = spawn(shell, shellArgs, {
                cwd: initialCwd,
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor'
                },
                shell: true
            });

            const sessionData = {
                process: termProcess,
                user,
                ip,
                lineBuffer: ''
            };

            this.sessions.set(sessionId, sessionData);

            this.auditLogger.log({
                username: user.username,
                ip,
                action: 'TERMINAL_OPEN',
                details: `Terminal oturumu başlatıldı (${shell}).`
            });

            // STDOUT
            termProcess.stdout.on('data', (data) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'terminal:output',
                        data: data.toString('utf8')
                    }));
                }
            });

            // STDERR
            termProcess.stderr.on('data', (data) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'terminal:output',
                        data: data.toString('utf8')
                    }));
                }
            });

            // PROCESS EXIT
            termProcess.on('exit', (code) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'terminal:exit',
                        code
                    }));
                }
                this.closeSession(sessionId);
            });

            termProcess.on('error', (err) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'terminal:error',
                        error: err.message
                    }));
                }
            });

            // Initial greeting
            ws.send(JSON.stringify({
                type: 'terminal:ready',
                cwd: initialCwd
            }));

        } catch (err) {
            ws.send(JSON.stringify({
                type: 'terminal:error',
                error: 'Terminal başlatılamadı: ' + err.message
            }));
        }
    }

    /**
     * Send stdin input to the running terminal process
     */
    handleInput(sessionId, inputData) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.process || session.process.killed) return;

        // Command auditing on Enter key
        for (let i = 0; i < inputData.length; i++) {
            const char = inputData[i];
            if (char === '\r' || char === '\n') {
                if (session.lineBuffer.trim().length > 0) {
                    this.auditLogger.log({
                        username: session.user.username,
                        ip: session.ip,
                        action: 'TERMINAL_COMMAND',
                        details: `Komut: ${session.lineBuffer.trim()}`
                    });
                    session.lineBuffer = '';
                }
            } else if (char === '\b' || char === '\x7f') {
                session.lineBuffer = session.lineBuffer.slice(0, -1);
            } else if (char.charCodeAt(0) >= 32) {
                session.lineBuffer += char;
            }
        }

        try {
            session.process.stdin.write(inputData);
        } catch (e) {
            console.error('Terminal write error:', e);
        }
    }

    /**
     * Close terminal session
     */
    closeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            try {
                if (session.process && !session.process.killed) {
                    session.process.kill();
                }
            } catch {}
            this.auditLogger.log({
                username: session.user.username,
                ip: session.ip,
                action: 'TERMINAL_CLOSE',
                details: 'Terminal oturumu sonlandırıldı.'
            });
            this.sessions.delete(sessionId);
        }
    }
}

module.exports = TerminalService;
