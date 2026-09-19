class LiveCollaborationHub {
    constructor(auditLogger) {
        this.auditLogger = auditLogger;
        // Map: fileKey (rootId + ':' + relPath) -> Set of client sockets with user info
        this.openFiles = new Map();
        // Map: socketId -> { user, fileKey, cursor, color }
        this.clientStates = new Map();
        
        this.colors = [
            '#3b82f6', '#10b981', '#f59e0b', '#ec4899', 
            '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'
        ];
    }

    getUserColor(username) {
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        return this.colors[Math.abs(hash) % this.colors.length];
    }

    joinFile(socketId, ws, user, rootId, relPath) {
        const fileKey = `${rootId}:${relPath}`;
        
        // Leave previous file if any
        this.leaveFile(socketId);

        if (!this.openFiles.has(fileKey)) {
            this.openFiles.set(fileKey, new Map());
        }

        const userColor = this.getUserColor(user.username);
        const userInfo = {
            socketId,
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            color: userColor,
            cursor: { line: 1, column: 1 },
            ws
        };

        this.openFiles.get(fileKey).set(socketId, userInfo);
        this.clientStates.set(socketId, { ...userInfo, fileKey });

        // Broadcast user joined to everyone in the same file
        this.broadcastToFile(fileKey, {
            type: 'collab:user_joined',
            fileKey,
            user: {
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
                color: userColor,
                cursor: { line: 1, column: 1 }
            },
            allUsers: this.getFileUsers(fileKey)
        });
    }

    handleCursorMove(socketId, position, selection) {
        const state = this.clientStates.get(socketId);
        if (!state || !state.fileKey) return;

        state.cursor = position;
        state.selection = selection;

        this.broadcastToFile(state.fileKey, {
            type: 'collab:cursor_update',
            socketId,
            userId: state.userId,
            username: state.username,
            color: state.color,
            position,
            selection
        }, socketId); // Skip sender
    }

    handleFileEdit(socketId, changeData) {
        const state = this.clientStates.get(socketId);
        if (!state || !state.fileKey) return;

        // Broadcast content update to everyone else in this file
        this.broadcastToFile(state.fileKey, {
            type: 'collab:content_change',
            socketId,
            userId: state.userId,
            username: state.username,
            change: changeData
        }, socketId); // Skip sender
    }

    leaveFile(socketId) {
        const state = this.clientStates.get(socketId);
        if (!state || !state.fileKey) return;

        const fileKey = state.fileKey;
        const fileClients = this.openFiles.get(fileKey);
        
        if (fileClients) {
            fileClients.delete(socketId);
            if (fileClients.size === 0) {
                this.openFiles.delete(fileKey);
            } else {
                this.broadcastToFile(fileKey, {
                    type: 'collab:user_left',
                    fileKey,
                    socketId,
                    userId: state.userId,
                    username: state.username,
                    allUsers: this.getFileUsers(fileKey)
                });
            }
        }

        this.clientStates.delete(socketId);
    }

    getFileUsers(fileKey) {
        const clients = this.openFiles.get(fileKey);
        if (!clients) return [];
        return Array.from(clients.values()).map(c => ({
            socketId: c.socketId,
            userId: c.userId,
            username: c.username,
            displayName: c.displayName,
            color: c.color,
            cursor: c.cursor
        }));
    }

    broadcastToFile(fileKey, message, excludeSocketId = null) {
        const clients = this.openFiles.get(fileKey);
        if (!clients) return;

        const msgStr = JSON.stringify(message);
        for (const [sockId, client] of clients.entries()) {
            if (sockId !== excludeSocketId && client.ws.readyState === client.ws.OPEN) {
                client.ws.send(msgStr);
            }
        }
    }
}

module.exports = LiveCollaborationHub;
