class RemoteTerminalManager {
    constructor() {
        this.container = null;
        this.outputEl = null;
        this.inputEl = null;
        this.isOpen = false;
        this.isDrawerOpen = false;
        this.history = [];
        this.historyIndex = -1;
    }

    init(containerEl) {
        this.container = containerEl;
        this.renderTerminalUI();
        this.setupWsHandlers();
        this.setupKeyboardToggle();
    }

    setupKeyboardToggle() {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '`') {
                e.preventDefault();
                this.toggleTerminalDrawer();
            }
        });

        const btnToggle = document.getElementById('btn-toggle-docked-term');
        if (btnToggle) {
            btnToggle.onclick = () => this.toggleTerminalDrawer();
        }
    }

    toggleTerminalDrawer() {
        const drawer = document.getElementById('docked-terminal-panel');
        if (!drawer) return;

        this.isDrawerOpen = !this.isDrawerOpen;
        if (this.isDrawerOpen) {
            drawer.classList.remove('collapsed');
            if (!this.isOpen) {
                this.startSession();
            }
            if (this.inputEl) {
                setTimeout(() => this.inputEl.focus(), 150);
            }
        } else {
            drawer.classList.add('collapsed');
        }
    }

    renderTerminalUI() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="cli-container" id="cli-scroll">
                <div class="cli-output" id="term-output">VDS PowerShell Terminaline bağlanılıyor...\n</div>
                <div class="cli-input-line">
                    <span class="cli-prompt" id="term-prompt">VDS &gt;</span>
                    <input type="text" id="term-input" class="cli-input" autocomplete="off" spellcheck="false" />
                </div>
            </div>
        `;

        this.outputEl = document.getElementById('term-output');
        this.inputEl = document.getElementById('term-input');

        document.getElementById('cli-scroll').onclick = () => {
            if (this.inputEl) this.inputEl.focus();
        };

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.inputEl.value;
                this.inputEl.value = '';
                if (cmd.trim().length > 0) {
                    this.history.push(cmd);
                    this.historyIndex = this.history.length;
                }
                this.appendOutput(`\n${document.getElementById('term-prompt').textContent} ${cmd}\n`);
                window.api.sendWs({
                    type: 'terminal:input',
                    data: cmd + '\r\n'
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.inputEl.value = this.history[this.historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.inputEl.value = this.history[this.historyIndex];
                } else {
                    this.historyIndex = this.history.length;
                    this.inputEl.value = '';
                }
            }
        });
    }

    setupWsHandlers() {
        window.api.onWs('terminal:output', (msg) => {
            this.appendOutput(msg.data);
        });

        window.api.onWs('terminal:ready', (msg) => {
            this.appendOutput(`\n[VDS Terminal Bağlantısı Kuruldu - ${msg.cwd}]\n`);
            this.isOpen = true;
        });

        window.api.onWs('terminal:error', (msg) => {
            this.appendOutput(`\n[HATA]: ${msg.error}\n`);
        });

        window.api.onWs('terminal:exit', (msg) => {
            this.appendOutput(`\n[Terminal sonlandı (Kod: ${msg.code})]\n`);
            this.isOpen = false;
        });
    }

    startSession() {
        if (this.outputEl) {
            this.outputEl.textContent = 'VDS Terminaline bağlanılıyor...\n';
        }
        window.api.sendWs({ type: 'terminal:start' });
        if (this.inputEl) this.inputEl.focus();
    }

    appendOutput(text) {
        if (!this.outputEl) return;
        this.outputEl.textContent += text;
        const scrollContainer = document.getElementById('cli-scroll');
        if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
    }
}

window.remoteTerminal = new RemoteTerminalManager();
