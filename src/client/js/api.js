class ApiClient {
    constructor() {
        this.baseUrl = '';
        this.token = localStorage.getItem('vds_token') || null;
        this.user = null;
        this.ws = null;
        this.wsHandlers = new Map();
    }

    setServerUrl(host, port) {
        let cleanHost = (host || '127.0.0.1').trim();
        if (cleanHost.startsWith('http://') || cleanHost.startsWith('https://')) {
            this.baseUrl = cleanHost.replace(/\/+$/, '');
        } else {
            this.baseUrl = `http://${cleanHost}:${port || 8899}`;
        }
    }

    getWsUrl() {
        const wsProto = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
        const hostPart = this.baseUrl.replace(/^https?:\/\//, '');
        return `${wsProto}://${hostPart}`;
    }

    setToken(token, user = null) {
        this.token = token;
        this.user = user;
        if (token) {
            localStorage.setItem('vds_token', token);
        } else {
            localStorage.removeItem('vds_token');
        }
    }

    async request(endpoint, options = {}) {
        if (!this.baseUrl) {
            this.setServerUrl('127.0.0.1', 8899);
        }

        const url = `${this.baseUrl}${endpoint}`;
        const headers = options.headers || {};

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        // Only set Content-Type to JSON if NOT FormData
        if (!(options.body instanceof FormData) && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'İşlem sırasında bir hata oluştu.');
            }
            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err);
            throw err;
        }
    }

    // Auth
    async login(username, password) {
        const data = await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        this.setToken(data.token, data.user);
        this.connectWebSocket();
        return data;
    }

    async logout() {
        try {
            await this.request('/api/auth/logout', { method: 'POST' });
        } catch {}
        this.setToken(null, null);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async getMe() {
        const data = await this.request('/api/auth/me');
        this.user = data.user;
        return data;
    }

    // Files
    async listRoots() {
        return this.request('/api/files/roots');
    }

    async listFiles(rootId = 'default', path = '') {
        return this.request(`/api/files/list?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);
    }

    async readFile(rootId = 'default', path = '') {
        return this.request(`/api/files/read?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);
    }

    async writeFile(rootId = 'default', path = '', content = '') {
        return this.request('/api/files/write', {
            method: 'POST',
            body: JSON.stringify({ rootId, path, content })
        });
    }

    async createFolder(rootId = 'default', path = '') {
        return this.request('/api/files/create-folder', {
            method: 'POST',
            body: JSON.stringify({ rootId, path })
        });
    }

    async deleteItem(rootId = 'default', path = '') {
        return this.request('/api/files/delete', {
            method: 'POST',
            body: JSON.stringify({ rootId, path })
        });
    }

    async renameItem(rootId = 'default', oldPath = '', newPath = '') {
        return this.request('/api/files/rename', {
            method: 'POST',
            body: JSON.stringify({ rootId, oldPath, newPath })
        });
    }

    async uploadFiles(rootId, folder, files) {
        const formData = new FormData();
        formData.append('rootId', rootId || 'default');
        formData.append('folder', folder || '');
        for (const file of files) {
            formData.append('files', file);
        }
        return this.request('/api/files/upload', {
            method: 'POST',
            body: formData
        });
    }

    getDownloadUrl(rootId = 'default', path = '') {
        return `${this.baseUrl}/api/files/download?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}&token=${this.token}`;
    }

    // Admin & Shared folder
    async getSharedFolder() {
        return this.request('/api/admin/shared-folder');
    }

    async setSharedFolder(folderPath) {
        return this.request('/api/admin/shared-folder', {
            method: 'POST',
            body: JSON.stringify({ folderPath })
        });
    }

    async getUsers() {
        return this.request('/api/admin/users');
    }

    async createUser(userData) {
        return this.request('/api/admin/users/create', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    }

    async updateUser(id, updates) {
        return this.request(`/api/admin/users/update/${id}`, {
            method: 'POST',
            body: JSON.stringify(updates)
        });
    }

    async deleteUser(id) {
        return this.request(`/api/admin/users/delete/${id}`, {
            method: 'POST'
        });
    }

    async getSystemStats() {
        return this.request('/api/admin/system-stats');
    }

    async getLogs(limit = 200) {
        return this.request(`/api/logs?limit=${limit}`);
    }

    async getActiveSessions() {
        return this.request('/api/admin/sessions');
    }

    async kickUser(userId) {
        return this.request('/api/admin/sessions/kick', {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
    }

    // WebSockets
    connectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }

        const wsUrl = this.getWsUrl();
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            if (this.token) {
                this.sendWs({ type: 'auth', token: this.token });
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                const handlers = this.wsHandlers.get(msg.type);
                if (handlers) {
                    for (const cb of handlers) cb(msg);
                }
            } catch (e) {
                console.error('WS Parse Error:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('WS Connection closed');
        };
    }

    sendWs(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    onWs(type, callback) {
        if (!this.wsHandlers.has(type)) {
            this.wsHandlers.set(type, new Set());
        }
        this.wsHandlers.get(type).add(callback);
    }

    offWs(type, callback) {
        if (this.wsHandlers.has(type)) {
            this.wsHandlers.get(type).delete(callback);
        }
    }
}

window.api = new ApiClient();
