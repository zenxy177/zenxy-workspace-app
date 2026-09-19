class Application {
    constructor() {
        this.currentView = 'connect'; // 'host' | 'connect' | 'client'
    }

    init() {
        this.bindTitlebar();
        this.bindDockNavigation();
        this.bindModals();
        this.bindPasswordToggles();

        if (window.hostPanel) window.hostPanel.init();
        if (window.clientWorkspace) window.clientWorkspace.init();
    }

    bindPasswordToggles() {
        document.querySelectorAll('.btn-toggle-pw').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                const wrap = btn.closest('.password-input-wrap');
                const input = wrap?.querySelector('input');
                const iconOpen = btn.querySelector('.icon-eye-open');
                const iconClosed = btn.querySelector('.icon-eye-closed');

                if (!input) return;

                if (input.type === 'password') {
                    input.type = 'text';
                    if (iconOpen) iconOpen.style.display = 'none';
                    if (iconClosed) iconClosed.style.display = 'inline-block';
                    btn.style.color = 'var(--primary)';
                    btn.title = 'Şifreyi Gizle';
                } else {
                    input.type = 'password';
                    if (iconOpen) iconOpen.style.display = 'inline-block';
                    if (iconClosed) iconClosed.style.display = 'none';
                    btn.style.color = 'var(--text-tertiary)';
                    btn.title = 'Şifreyi Göster';
                }
            };
        });
    }

    bindTitlebar() {
        document.getElementById('btn-min')?.addEventListener('click', () => {
            window.electronAPI?.minimize();
        });
        document.getElementById('btn-max')?.addEventListener('click', () => {
            window.electronAPI?.maximize();
        });
        document.getElementById('btn-close')?.addEventListener('click', () => {
            window.electronAPI?.close();
        });
    }

    bindDockNavigation() {
        const btnHost = document.getElementById('dock-btn-host');
        const btnConnect = document.getElementById('dock-btn-connect');
        const btnClient = document.getElementById('dock-btn-client');

        btnHost?.addEventListener('click', () => this.switchView('host'));
        btnConnect?.addEventListener('click', () => this.switchView('connect'));
        btnClient?.addEventListener('click', () => {
            if (!window.api.token) {
                this.showToast('Lütfen önce VDS bağlantısı kurun ve giriş yapın.', 'info');
                this.switchView('connect');
            } else {
                this.switchView('client');
            }
        });

        // Welcome Mode Selector Cards
        document.getElementById('mode-card-host')?.addEventListener('click', () => {
            this.switchView('host');
        });
        document.getElementById('mode-card-client')?.addEventListener('click', () => {
            this.switchView('connect');
        });
    }

    switchView(viewName) {
        this.currentView = viewName;

        const btnHost = document.getElementById('dock-btn-host');
        const btnConnect = document.getElementById('dock-btn-connect');
        const btnClient = document.getElementById('dock-btn-client');

        const viewHost = document.getElementById('view-host');
        const viewConnect = document.getElementById('view-connect');
        const viewClient = document.getElementById('view-client');

        // Reset active dock states
        [btnHost, btnConnect, btnClient].forEach(btn => btn?.classList.remove('active'));
        [viewHost, viewConnect, viewClient].forEach(view => {
            if (view) view.style.display = 'none';
        });

        if (viewName === 'host') {
            btnHost?.classList.add('active');
            if (viewHost) viewHost.style.display = 'flex';
        } else if (viewName === 'connect') {
            btnConnect?.classList.add('active');
            if (viewConnect) viewConnect.style.display = 'flex';
        } else if (viewName === 'client') {
            btnClient?.classList.add('active');
            if (viewClient) viewClient.style.display = 'flex';
        }
    }

    updateConnectionStatus(isConnected, user = null, serverAddress = '') {
        const indicator = document.getElementById('dock-connection-indicator');
        const form = document.getElementById('connect-hub-form');
        const activeCard = document.getElementById('connect-active-card');
        const summary = document.getElementById('active-session-summary');

        if (isConnected && user) {
            if (indicator) {
                indicator.style.background = 'var(--emerald)';
                indicator.style.boxShadow = '0 0 8px var(--emerald)';
            }
            if (form) form.style.display = 'none';
            if (activeCard) activeCard.style.display = 'flex';
            if (summary) {
                summary.innerHTML = `<strong>${user.displayName || user.username}</strong> (${user.role === 'admin' ? 'Yönetici' : 'Üye'}) <br><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);">${serverAddress}</span>`;
            }
        } else {
            if (indicator) {
                indicator.style.background = 'var(--text-tertiary)';
                indicator.style.boxShadow = 'none';
            }
            if (form) form.style.display = 'flex';
            if (activeCard) activeCard.style.display = 'none';
        }
    }

    bindModals() {
        document.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            };
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                }
            });
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            }
        });
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast-pro ${type}`;
        
        let iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
        if (type === 'success') {
            iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
        }
        if (type === 'error') {
            iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        }

        toast.innerHTML = `${iconSvg}<span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px) scale(0.95)';
            toast.style.transition = 'all 0.25s ease';
            setTimeout(() => toast.remove(), 250);
        }, 3500);
    }
}

window.app = new Application();
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});
