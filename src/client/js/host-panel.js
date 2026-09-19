class HostPanelManager {
    constructor() {
        this.isServerRunning = false;
        this.metricsInterval = null;
        this.currentTab = 'users';
        this.allUsers = [];
        this.allLogs = [];
        this.currentSharedPath = '';
    }

    async init() {
        this.bindEvents();
        await this.checkStatus();
        await this.loadSharedFolder();
    }

    bindEvents() {
        const btnToggle = document.getElementById('btn-toggle-server');
        if (btnToggle) {
            btnToggle.onclick = () => this.toggleServer();
        }

        const navBtns = document.querySelectorAll('.host-subnav-btn');
        navBtns.forEach(btn => {
            btn.onclick = () => {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.switchHostTab(btn.dataset.tab);
            };
        });

        const btnAddUser = document.getElementById('btn-open-add-user');
        if (btnAddUser) {
            btnAddUser.onclick = () => this.openAddUserModal();
        }

        const userForm = document.getElementById('user-form');
        if (userForm) {
            userForm.onsubmit = (e) => this.handleSaveUser(e);
        }

        const searchInput = document.getElementById('host-search-input');
        if (searchInput) {
            searchInput.oninput = () => this.filterData(searchInput.value.trim().toLowerCase());
        }

        // Browse Shared Folder Button
        const btnBrowse = document.getElementById('btn-browse-shared-folder');
        if (btnBrowse) {
            btnBrowse.onclick = () => this.browseSharedFolder();
        }

        // Password Strength Listener
        const userPwInput = document.getElementById('user-form-password');
        if (userPwInput) {
            userPwInput.addEventListener('input', () => this.updatePasswordStrengthUI(userPwInput.value));
        }

        window.api.onWs('log:stream', (msg) => {
            this.prependLogEntry(msg.entry);
        });
    }

    async loadSharedFolder() {
        try {
            if (window.electronAPI) {
                const folderPath = await window.electronAPI.getSharedFolder();
                if (folderPath) {
                    this.updateSharedFolderUI(folderPath);
                }
            } else if (window.api.token) {
                const res = await window.api.getSharedFolder();
                if (res.sharedFolder) {
                    this.updateSharedFolderUI(res.sharedFolder.path);
                }
            }
        } catch {}
    }

    async browseSharedFolder() {
        if (!window.electronAPI) {
            const customPath = prompt('Paylaşmak istediğiniz VDS klasör yolunu girin:', this.currentSharedPath || 'C:\\');
            if (customPath) {
                this.applySharedFolder(customPath);
            }
            return;
        }

        try {
            const folderPath = await window.electronAPI.selectFolder();
            if (folderPath) {
                this.updateSharedFolderUI(folderPath);
                window.app.showToast('Paylaşılan çalışma klasörü seçildi: ' + folderPath, 'success');
                
                // Immediately refresh workspace file tree if active
                if (window.clientWorkspace) {
                    window.clientWorkspace.loadDirectory('');
                }
            }
        } catch (err) {
            window.app.showToast('Klasör seçilemedi: ' + err.message, 'error');
        }
    }

    async applySharedFolder(folderPath) {
        try {
            if (window.electronAPI) {
                await window.electronAPI.setSharedFolder(folderPath);
            } else if (window.api.token) {
                await window.api.setSharedFolder(folderPath);
            }
            this.updateSharedFolderUI(folderPath);
            window.app.showToast('Paylaşılan klasör güncellendi!', 'success');
            
            if (window.clientWorkspace) {
                window.clientWorkspace.loadDirectory('');
            }
        } catch (err) {
            window.app.showToast('Hata: ' + err.message, 'error');
        }
    }

    updateSharedFolderUI(folderPath) {
        this.currentSharedPath = folderPath;
        const displayEl = document.getElementById('host-shared-folder-display');
        if (displayEl) {
            displayEl.textContent = folderPath;
            displayEl.title = folderPath;
        }
    }

    filterData(query) {
        if (this.currentTab === 'users') {
            const filtered = this.allUsers.filter(u => 
                u.username.toLowerCase().includes(query) || 
                (u.displayName && u.displayName.toLowerCase().includes(query))
            );
            this.renderUsersList(filtered);
        } else if (this.currentTab === 'logs') {
            const filtered = this.allLogs.filter(l => 
                l.username.toLowerCase().includes(query) || 
                l.action.toLowerCase().includes(query) || 
                l.details.toLowerCase().includes(query) ||
                l.ip.includes(query)
            );
            this.renderLogsList(filtered);
        }
    }

    async checkStatus() {
        if (window.electronAPI) {
            const status = await window.electronAPI.getServerStatus();
            this.updateServerUI(status);
        }
    }

    async toggleServer() {
        const btn = document.getElementById('btn-toggle-server');
        const portInput = document.getElementById('host-port-input');
        const port = parseInt(portInput?.value || '8899', 10);

        if (!this.isServerRunning) {
            btn.disabled = true;
            btn.innerHTML = '<span>Başlatılıyor...</span>';
            try {
                let res;
                if (window.electronAPI) {
                    res = await window.electronAPI.startServer(port);
                } else {
                    res = { success: true, port };
                }

                if (res.success) {
                    this.isServerRunning = true;
                    window.api.setServerUrl('127.0.0.1', port);
                    window.app.showToast(`VDS Sunucusu port ${port} üzerinde aktif edildi!`, 'success');
                    this.updateServerUI({ isRunning: true, port, localIps: res.localIps || ['127.0.0.1'] });
                    this.startMetricsPolling();

                    // Auto login as admin for host panel management
                    try {
                        await window.api.login('admin', 'Admin123!@#');
                    } catch {}

                    await this.loadSharedFolder();
                    await this.loadUsers();
                    await this.loadLogs();
                } else {
                    window.app.showToast('Sunucu başlatılamadı: ' + res.error, 'error');
                }
            } catch (err) {
                window.app.showToast('Hata: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        } else {
            btn.disabled = true;
            btn.innerHTML = '<span>Durduruluyor...</span>';
            try {
                if (window.electronAPI) {
                    await window.electronAPI.stopServer();
                }
                this.isServerRunning = false;
                this.stopMetricsPolling();
                this.updateServerUI({ isRunning: false, port });
                window.app.showToast('VDS Sunucusu durduruldu.', 'info');
            } catch (err) {
                window.app.showToast('Hata: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        }
    }

    updateServerUI(status) {
        this.isServerRunning = status.isRunning;
        const btn = document.getElementById('btn-toggle-server');
        const pulseDot = document.getElementById('host-pulse-dot');
        const statusText = document.getElementById('host-status-text');
        const ipDisplay = document.getElementById('host-ips-display');
        const portInput = document.getElementById('host-port-input');

        if (status.isRunning) {
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                <span>Sunucuyu Durdur</span>
            `;
            btn.className = 'btn-danger-subtle';
            pulseDot.className = 'pulse-dot online';
            statusText.textContent = `Çalışıyor (${status.port})`;
            if (portInput) portInput.disabled = true;

            const ips = status.localIps || ['127.0.0.1'];
            ipDisplay.innerHTML = ips.map(ip => `
                <div class="ip-chip">
                    <span>http://${ip}:${status.port}</span>
                    <button class="chip-copy-btn" onclick="navigator.clipboard.writeText('http://${ip}:${status.port}'); window.app.showToast('Adres kopyalandı!', 'info');" title="Kopyala">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                </div>
            `).join('');
        } else {
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Sunucuyu Başlat</span>
            `;
            btn.className = 'btn-primary-gradient';
            pulseDot.className = 'pulse-dot';
            statusText.textContent = 'Sunucu Kapalı';
            if (portInput) portInput.disabled = false;
            ipDisplay.innerHTML = '<span style="color: var(--text-tertiary); font-size: 11px;">Sunucu başlatıldığında adresler listelenecektir.</span>';
        }
    }

    startMetricsPolling() {
        this.stopMetricsPolling();
        this.pollMetrics();
        this.metricsInterval = setInterval(() => this.pollMetrics(), 3000);
    }

    stopMetricsPolling() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
    }

    async pollMetrics() {
        if (!this.isServerRunning) return;
        try {
            const data = await window.api.getSystemStats();
            if (data.stats) {
                const s = data.stats;
                document.getElementById('metric-cpu-count').textContent = `${s.cpus} Çekirdek`;
                document.getElementById('metric-ram-used').textContent = `${s.memory.usedMB} / ${s.memory.totalMB} MB`;
                document.getElementById('metric-sessions').textContent = `${s.activeSessionsCount}`;
                
                const ramBar = document.getElementById('metric-ram-bar');
                if (ramBar) ramBar.style.width = `${s.memory.percent}%`;
            }
        } catch {}
    }

    switchHostTab(tabName) {
        this.currentTab = tabName;
        document.querySelectorAll('.host-tab-content').forEach(el => {
            el.style.display = 'none';
        });
        const target = document.getElementById(`host-tab-${tabName}`);
        if (target) target.style.display = 'flex';

        if (tabName === 'users') this.loadUsers();
        if (tabName === 'logs') this.loadLogs();
        if (tabName === 'sessions') this.loadSessions();
    }

    async loadUsers() {
        try {
            const res = await window.api.getUsers();
            this.allUsers = res.users || [];
            this.renderUsersList(this.allUsers);
        } catch (err) {
            console.error('Kullanıcılar yüklenemedi:', err);
        }
    }

    renderUsersList(users) {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        for (const u of users) {
            const tr = document.createElement('tr');
            const p = u.permissions || {};
            const initials = (u.displayName || u.username).substring(0, 2).toUpperCase();

            tr.innerHTML = `
                <td>
                    <div class="user-meta-cell">
                        <div class="user-avatar-badge">${initials}</div>
                        <div>
                            <strong style="color:#fff; font-size:12px;">${u.username}</strong>
                            <div style="font-size:11px; color:var(--text-tertiary);">${u.displayName || ''}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="role-badge ${u.role}">${u.role === 'admin' ? 'Yönetici' : 'Üye'}</span>
                </td>
                <td>
                    <span class="perm-pill ${p.canRead ? 'active' : ''}">Oku</span>
                    <span class="perm-pill ${p.canWrite ? 'active' : ''}">Yaz</span>
                    <span class="perm-pill ${p.canDelete ? 'active' : ''}">Sil</span>
                    <span class="perm-pill ${p.canTerminal ? 'active' : ''}">Terminal</span>
                    <span class="perm-pill ${p.canViewLogs ? 'active' : ''}">Log</span>
                </td>
                <td>
                    <span style="font-size:11px; font-family:var(--font-mono); color:var(--text-secondary);">${p.allFolders ? 'Tüm Dizinler' : (p.allowedFolders?.join(', ') || 'Özel')}</span>
                </td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-ghost" style="padding:3px 8px; font-size:11px;" onclick="window.hostPanel.openEditUserModal('${u.id}')">Düzenle</button>
                        ${u.role !== 'admin' ? `<button class="btn-danger-subtle" style="padding:3px 8px; font-size:11px;" onclick="window.hostPanel.deleteUser('${u.id}')">Sil</button>` : ''}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    }

    openAddUserModal() {
        document.getElementById('user-modal-title').textContent = 'Yeni Kullanıcı Oluştur';
        document.getElementById('user-form-id').value = '';
        document.getElementById('user-form-username').value = '';
        document.getElementById('user-form-username').disabled = false;
        document.getElementById('user-form-password').value = '';
        document.getElementById('user-form-password').required = true;
        document.getElementById('user-form-displayname').value = '';
        document.getElementById('user-form-folders').value = '';

        document.getElementById('perm-all-folders').checked = true;
        document.getElementById('perm-read').checked = true;
        document.getElementById('perm-write').checked = true;
        document.getElementById('perm-delete').checked = false;
        document.getElementById('perm-terminal').checked = false;
        document.getElementById('perm-logs').checked = false;

        this.updatePasswordStrengthUI('');
        document.getElementById('user-modal').classList.add('active');
    }

    async openEditUserModal(userId) {
        try {
            const res = await window.api.getUsers();
            const user = res.users.find(u => u.id === userId);
            if (!user) return;

            document.getElementById('user-modal-title').textContent = 'Kullanıcıyı Düzenle: ' + user.username;
            document.getElementById('user-form-id').value = user.id;
            document.getElementById('user-form-username').value = user.username;
            document.getElementById('user-form-username').disabled = true;
            document.getElementById('user-form-password').value = '';
            document.getElementById('user-form-password').required = false;
            document.getElementById('user-form-displayname').value = user.displayName || '';
            document.getElementById('user-form-folders').value = user.permissions?.allowedFolders?.join(', ') || '';

            document.getElementById('perm-all-folders').checked = !!user.permissions?.allFolders;
            document.getElementById('perm-read').checked = !!user.permissions?.canRead;
            document.getElementById('perm-write').checked = !!user.permissions?.canWrite;
            document.getElementById('perm-delete').checked = !!user.permissions?.canDelete;
            document.getElementById('perm-terminal').checked = !!user.permissions?.canTerminal;
            document.getElementById('perm-logs').checked = !!user.permissions?.canViewLogs;

            this.updatePasswordStrengthUI('');
            document.getElementById('user-modal').classList.add('active');
        } catch (err) {
            window.app.showToast('Hata: ' + err.message, 'error');
        }
    }

    updatePasswordStrengthUI(password = '') {
        const label = document.getElementById('user-pw-strength-label');
        const seg1 = document.getElementById('user-pw-seg-1');
        const seg2 = document.getElementById('user-pw-seg-2');
        const seg3 = document.getElementById('user-pw-seg-3');
        const seg4 = document.getElementById('user-pw-seg-4');
        const segments = [seg1, seg2, seg3, seg4];

        const critLen = document.getElementById('user-pw-crit-len');
        const critUpper = document.getElementById('user-pw-crit-upper');
        const critLower = document.getElementById('user-pw-crit-lower');
        const critNum = document.getElementById('user-pw-crit-num');
        const critSym = document.getElementById('user-pw-crit-sym');

        if (!label || !seg1) return;

        // Reset segments
        segments.forEach(seg => {
            if (seg) {
                seg.className = 'pw-strength-bar-segment';
            }
        });

        if (!password) {
            label.textContent = 'Parola Gücü';
            label.style.color = 'var(--text-tertiary)';
            [critLen, critUpper, critLower, critNum, critSym].forEach(chip => {
                if (chip) {
                    chip.classList.remove('valid');
                    const icon = chip.querySelector('.chip-icon');
                    if (icon) icon.textContent = '✕';
                }
            });
            return;
        }

        // Evaluate criteria
        const hasLen = password.length >= 8;
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNum = /[0-9]/.test(password);
        const hasSym = /[^A-Za-z0-9]/.test(password);

        const updateChip = (chip, isValid) => {
            if (!chip) return;
            if (isValid) {
                chip.classList.add('valid');
                const icon = chip.querySelector('.chip-icon');
                if (icon) icon.textContent = '✓';
            } else {
                chip.classList.remove('valid');
                const icon = chip.querySelector('.chip-icon');
                if (icon) icon.textContent = '✕';
            }
        };

        updateChip(critLen, hasLen);
        updateChip(critUpper, hasUpper);
        updateChip(critLower, hasLower);
        updateChip(critNum, hasNum);
        updateChip(critSym, hasSym);

        let criteriaCount = 0;
        if (hasLen) criteriaCount++;
        if (hasUpper) criteriaCount++;
        if (hasLower) criteriaCount++;
        if (hasNum) criteriaCount++;
        if (hasSym) criteriaCount++;

        // Calculate score level (1 to 4)
        let level = 1;
        let levelText = 'Zayıf Parola';
        let levelClass = 'active-weak';
        let levelColor = '#ef4444';

        if (password.length < 6 || criteriaCount <= 2) {
            level = 1;
            levelText = '🔴 Çok Zayıf (Güvensiz)';
            levelClass = 'active-weak';
            levelColor = '#ef4444';
        } else if (criteriaCount === 3) {
            level = 2;
            levelText = '🟠 Orta Seviye';
            levelClass = 'active-fair';
            levelColor = '#f97316';
        } else if (criteriaCount === 4) {
            level = 3;
            levelText = '🟡 İyi & Yeterli';
            levelClass = 'active-good';
            levelColor = '#eab308';
        } else if (criteriaCount === 5) {
            level = 4;
            levelText = '🟢 Çok Güçlü (Kurumsal) 🛡️';
            levelClass = 'active-strong';
            levelColor = '#10b981';
        }

        label.textContent = levelText;
        label.style.color = levelColor;

        for (let i = 0; i < level; i++) {
            if (segments[i]) {
                segments[i].classList.add(levelClass);
            }
        }
    }

    async handleSaveUser(e) {
        e.preventDefault();
        const id = document.getElementById('user-form-id').value;
        const username = document.getElementById('user-form-username').value.trim();
        const password = document.getElementById('user-form-password').value;
        const displayName = document.getElementById('user-form-displayname').value.trim();
        const folderStr = document.getElementById('user-form-folders').value.trim();

        // Enforce basic password complexity if creating new user or changing password
        if ((!id || password) && password.length < 6) {
            window.app.showToast('Güvenlik Uyarısı: Parola en az 6 karakter olmalıdır!', 'error');
            return;
        }

        const permissions = {
            allFolders: document.getElementById('perm-all-folders').checked,
            allowedFolders: folderStr ? folderStr.split(',').map(s => s.trim()).filter(Boolean) : [],
            canRead: document.getElementById('perm-read').checked,
            canWrite: document.getElementById('perm-write').checked,
            canDelete: document.getElementById('perm-delete').checked,
            canTerminal: document.getElementById('perm-terminal').checked,
            canViewLogs: document.getElementById('perm-logs').checked
        };

        try {
            if (id) {
                await window.api.updateUser(id, { password: password || undefined, displayName, permissions });
                window.app.showToast('Kullanıcı güncellendi.', 'success');
            } else {
                await window.api.createUser({ username, password, displayName, permissions });
                window.app.showToast('Yeni kullanıcı oluşturuldu.', 'success');
            }
            document.getElementById('user-modal').classList.remove('active');
            this.loadUsers();
        } catch (err) {
            window.app.showToast(err.message, 'error');
        }
    }

    async deleteUser(userId) {
        if (!confirm('Bu kullanıcıyı silmek istediğinize emin misiniz?')) return;
        try {
            await window.api.deleteUser(userId);
            window.app.showToast('Kullanıcı silindi.', 'success');
            this.loadUsers();
        } catch (err) {
            window.app.showToast(err.message, 'error');
        }
    }

    async loadLogs() {
        try {
            const res = await window.api.getLogs(200);
            this.allLogs = res.logs || [];
            this.renderLogsList(this.allLogs);
        } catch (err) {
            console.error('Loglar yüklenemedi:', err);
        }
    }

    renderLogsList(logs) {
        const tbody = document.getElementById('logs-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        for (const entry of logs) {
            tbody.appendChild(this.createLogRow(entry));
        }
    }

    prependLogEntry(entry) {
        this.allLogs.unshift(entry);
        const tbody = document.getElementById('logs-table-body');
        if (!tbody) return;
        const row = this.createLogRow(entry);
        tbody.insertBefore(row, tbody.firstChild);
    }

    createLogRow(entry) {
        const tr = document.createElement('tr');
        const time = new Date(entry.timestamp).toLocaleTimeString();
        tr.innerHTML = `
            <td style="font-family:var(--font-mono); font-size:11px; color:var(--text-tertiary);">${time}</td>
            <td><strong style="color:#fff;">${entry.username}</strong></td>
            <td style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);">${entry.ip}</td>
            <td><span class="perm-pill active" style="font-family:var(--font-mono);">${entry.action}</span></td>
            <td style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--font-mono); font-size:11px;">${entry.target}</td>
            <td style="font-size:11px; color:var(--text-secondary);">${entry.details}</td>
        `;
        return tr;
    }

    async loadSessions() {
        try {
            const res = await window.api.getActiveSessions();
            const tbody = document.getElementById('sessions-table-body');
            if (!tbody) return;

            tbody.innerHTML = '';
            for (const s of res.sessions) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${s.username}</strong> (${s.displayName || ''})</td>
                    <td style="font-family:var(--font-mono); font-size:11px;">${s.ip}</td>
                    <td style="font-size:11px; color:var(--text-tertiary);">${new Date(s.loginTime).toLocaleTimeString()}</td>
                    <td>
                        <button class="btn-danger-subtle" style="padding:3px 8px; font-size:11px;" onclick="window.hostPanel.kickSession('${s.userId}')">Bağlantıyı Kes</button>
                    </td>
                `;
                tbody.appendChild(tr);
            }
        } catch (err) {}
    }

    async kickSession(userId) {
        try {
            await window.api.kickUser(userId);
            window.app.showToast('Kullanıcı oturumu sonlandırıldı.', 'info');
            this.loadSessions();
        } catch (err) {
            window.app.showToast(err.message, 'error');
        }
    }
}

window.hostPanel = new HostPanelManager();
