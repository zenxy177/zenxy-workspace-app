class CodeEditorManager {
    constructor() {
        this.openTabs = new Map(); // fileKey -> { rootId, relPath, name, content, isDirty, modifiedAt, language }
        this.activeTabKey = null;
        this.editorContainer = null;
        this.isInternalChange = false;
        this.collaboratorDecorations = new Map();
        this.fontSize = parseInt(localStorage.getItem('vds_editor_fontsize') || '13', 10);
        this.wordWrap = localStorage.getItem('vds_editor_wordwrap') === 'true';
        this.findMatches = [];
        this.currentMatchIndex = -1;
    }

    init(containerEl) {
        this.editorContainer = containerEl || document.getElementById('editor-content-area');
        this.setupKeyboardShortcuts();
        this.setupToolbarButtons();
        this.setupCollabListeners();
        this.setupFindWidget();
        this.updateFontSizeUI();
        this.updateWordWrapUI();
    }

    getContainer() {
        if (!this.editorContainer || !document.contains(this.editorContainer)) {
            this.editorContainer = document.getElementById('editor-content-area');
        }
        return this.editorContainer;
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 's') {
                    e.preventDefault();
                    this.saveCurrentFile();
                } else if (key === 'f') {
                    e.preventDefault();
                    this.openFindWidget();
                } else if (key === '+' || key === '=') {
                    e.preventDefault();
                    this.changeFontSize(1);
                } else if (key === '-' || key === '_') {
                    e.preventDefault();
                    this.changeFontSize(-1);
                } else if (key === '0') {
                    e.preventDefault();
                    this.setFontSize(13);
                }
            } else if (e.altKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                this.toggleWordWrap();
            }
        });
    }

    setupToolbarButtons() {
        const btnSave = document.getElementById('btn-editor-save');
        if (btnSave) {
            btnSave.onclick = () => this.saveCurrentFile();
        }

        const btnFind = document.getElementById('btn-editor-find');
        if (btnFind) {
            btnFind.onclick = () => this.openFindWidget();
        }

        const btnWrap = document.getElementById('btn-editor-wrap');
        if (btnWrap) {
            btnWrap.onclick = () => this.toggleWordWrap();
        }

        const btnTerm = document.getElementById('btn-editor-term');
        if (btnTerm) {
            btnTerm.onclick = () => {
                if (window.remoteTerminal) {
                    window.remoteTerminal.toggleTerminalDrawer();
                }
            };
        }

        const rootBreadcrumb = document.getElementById('breadcrumb-root-btn');
        if (rootBreadcrumb) {
            rootBreadcrumb.onclick = () => {
                if (window.clientWorkspace) {
                    window.clientWorkspace.loadDirectory('');
                }
            };
        }

        // Font Zoom Buttons
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.changeFontSize(1));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.changeFontSize(-1));
        document.getElementById('editor-font-size-label')?.addEventListener('click', () => this.setFontSize(13));
    }

    setupFindWidget() {
        const widget = document.getElementById('editor-find-widget');
        const input = document.getElementById('find-search-input');
        const btnClose = document.getElementById('btn-find-close');
        const btnNext = document.getElementById('btn-find-next');
        const btnPrev = document.getElementById('btn-find-prev');

        if (!widget || !input) return;

        input.addEventListener('input', () => this.executeFind());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.findPrev();
                } else {
                    this.findNext();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeFindWidget();
            }
        });

        btnNext?.addEventListener('click', () => this.findNext());
        btnPrev?.addEventListener('click', () => this.findPrev());
        btnClose?.addEventListener('click', () => this.closeFindWidget());
    }

    openFindWidget() {
        const widget = document.getElementById('editor-find-widget');
        const input = document.getElementById('find-search-input');
        const textarea = document.getElementById('code-textarea');
        if (!widget || !input) return;

        widget.style.display = 'flex';

        if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
            const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
            if (selectedText && !selectedText.includes('\n')) {
                input.value = selectedText;
            }
        }

        input.focus();
        input.select();
        this.executeFind();
    }

    closeFindWidget() {
        const widget = document.getElementById('editor-find-widget');
        if (widget) widget.style.display = 'none';
        const textarea = document.getElementById('code-textarea');
        if (textarea) textarea.focus();
    }

    executeFind() {
        const input = document.getElementById('find-search-input');
        const countEl = document.getElementById('find-match-count');
        const textarea = document.getElementById('code-textarea');

        if (!input || !countEl || !textarea) return;

        const query = input.value;
        if (!query) {
            this.findMatches = [];
            this.currentMatchIndex = -1;
            countEl.textContent = '0/0';
            return;
        }

        const text = textarea.value;
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const matches = [];
        let pos = 0;

        while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
            matches.push(pos);
            pos += lowerQuery.length || 1;
        }

        this.findMatches = matches;

        if (matches.length > 0) {
            const cursor = textarea.selectionStart || 0;
            let targetIdx = matches.findIndex(p => p >= cursor);
            if (targetIdx === -1) targetIdx = 0;
            this.currentMatchIndex = targetIdx;
            this.highlightMatch(this.currentMatchIndex);
        } else {
            this.currentMatchIndex = -1;
            countEl.textContent = '0/0';
        }
    }

    findNext() {
        if (this.findMatches.length === 0) return;
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.findMatches.length;
        this.highlightMatch(this.currentMatchIndex);
    }

    findPrev() {
        if (this.findMatches.length === 0) return;
        this.currentMatchIndex = (this.currentMatchIndex - 1 + this.findMatches.length) % this.findMatches.length;
        this.highlightMatch(this.currentMatchIndex);
    }

    highlightMatch(index) {
        const textarea = document.getElementById('code-textarea');
        const countEl = document.getElementById('find-match-count');
        const input = document.getElementById('find-search-input');

        if (!textarea || index < 0 || index >= this.findMatches.length) return;

        const query = input?.value || '';
        const start = this.findMatches[index];
        const end = start + query.length;

        textarea.focus();
        textarea.setSelectionRange(start, end);

        if (countEl) {
            countEl.textContent = `${index + 1}/${this.findMatches.length}`;
        }
    }

    toggleWordWrap() {
        this.wordWrap = !this.wordWrap;
        localStorage.setItem('vds_editor_wordwrap', this.wordWrap.toString());
        this.applyWordWrap();
        this.updateWordWrapUI();
        window.app?.showToast(this.wordWrap ? 'Satır Kaydırma (Word Wrap) Açık' : 'Satır Kaydırma (Word Wrap) Kapalı', 'info');
    }

    updateWordWrapUI() {
        const btnWrap = document.getElementById('btn-editor-wrap');
        if (btnWrap) {
            if (this.wordWrap) {
                btnWrap.classList.add('active');
            } else {
                btnWrap.classList.remove('active');
            }
        }
    }

    applyWordWrap() {
        const textarea = document.getElementById('code-textarea');
        if (!textarea) return;

        if (this.wordWrap) {
            textarea.style.whiteSpace = 'pre-wrap';
            textarea.style.overflowWrap = 'anywhere';
        } else {
            textarea.style.whiteSpace = 'pre';
            textarea.style.overflowWrap = 'normal';
        }
        this.updateWordWrapUI();
    }

    changeFontSize(delta) {
        this.setFontSize(this.fontSize + delta);
    }

    setFontSize(size) {
        const clamped = Math.max(10, Math.min(26, size));
        this.fontSize = clamped;
        localStorage.setItem('vds_editor_fontsize', clamped.toString());
        this.updateFontSizeUI();
        this.applyFontSize();
    }

    updateFontSizeUI() {
        const label = document.getElementById('editor-font-size-label');
        if (label) label.textContent = `${this.fontSize}px`;
    }

    applyFontSize() {
        const textarea = document.getElementById('code-textarea');
        const lineNums = document.getElementById('line-numbers');
        const lineHeight = Math.round(this.fontSize * 1.54);

        if (textarea) {
            textarea.style.fontSize = `${this.fontSize}px`;
            textarea.style.lineHeight = `${lineHeight}px`;
        }
        if (lineNums) {
            lineNums.style.fontSize = `${this.fontSize}px`;
            lineNums.style.lineHeight = `${lineHeight}px`;
        }
    }

    setupCollabListeners() {
        window.api.onWs('collab:user_joined', (data) => {
            if (this.activeTabKey === data.fileKey) {
                this.renderCollaborators(data.allUsers);
                window.app.showToast(`${data.user.displayName || data.user.username} dosyaya katıldı.`, 'info');
            }
        });

        window.api.onWs('collab:user_left', (data) => {
            if (this.activeTabKey === data.fileKey) {
                this.renderCollaborators(data.allUsers);
            }
        });

        window.api.onWs('collab:content_change', (data) => {
            const tab = this.openTabs.get(this.activeTabKey);
            if (tab && !this.isInternalChange) {
                this.isInternalChange = true;
                const textarea = document.getElementById('code-textarea');
                if (textarea && data.change?.fullContent !== undefined) {
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    textarea.value = data.change.fullContent;
                    textarea.setSelectionRange(start, end);
                    tab.content = data.change.fullContent;
                    const lineNums = document.getElementById('line-numbers');
                    if (lineNums) this.updateLineNumbers(textarea, lineNums);
                }
                this.isInternalChange = false;
            }
        });
    }

    detectLanguage(filename) {
        const lower = (filename || '').toLowerCase();
        if (lower === 'dockerfile' || lower.startsWith('docker-compose')) return 'Docker';
        if (lower.startsWith('.env')) return 'Env Config';
        
        const ext = lower.split('.').pop();
        const map = {
            'js': 'JavaScript',
            'mjs': 'JavaScript',
            'cjs': 'JavaScript',
            'jsx': 'React JavaScript',
            'ts': 'TypeScript',
            'tsx': 'React TypeScript',
            'json': 'JSON',
            'jsonc': 'JSON',
            'html': 'HTML',
            'htm': 'HTML',
            'css': 'CSS',
            'scss': 'SCSS',
            'sass': 'SASS',
            'less': 'LESS',
            'py': 'Python',
            'cpp': 'C++',
            'c': 'C',
            'cs': 'C#',
            'rs': 'Rust',
            'go': 'Go',
            'php': 'PHP',
            'sql': 'SQL',
            'sh': 'Shell',
            'bash': 'Bash',
            'bat': 'Batch',
            'cmd': 'Batch',
            'ps1': 'PowerShell',
            'md': 'Markdown',
            'txt': 'Düz Metin',
            'log': 'Log Metni',
            'yml': 'YAML',
            'yaml': 'YAML',
            'xml': 'XML',
            'toml': 'TOML',
            'ini': 'INI'
        };
        return map[ext] || 'Düz Metin';
    }

    getTabSvgIcon(filename) {
        if (window.clientWorkspace) {
            return window.clientWorkspace.getFileSvgIcon(filename, false);
        }
        return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>`;
    }

    async openFile(rootId, relPath) {
        if (!relPath && relPath !== '') {
            window.app?.showToast('Açılacak dosya yolu belirtilmedi.', 'error');
            return;
        }
        const normalizedRelPath = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
        const fileKey = `${rootId || 'default'}:${normalizedRelPath}`;
        const filename = normalizedRelPath.split('/').pop() || normalizedRelPath;

        if (this.openTabs.has(fileKey)) {
            this.switchTab(fileKey);
            return;
        }

        try {
            const data = await window.api.readFile(rootId, normalizedRelPath);
            if (!data.isText) {
                window.app.showToast('Bu dosya ikili (binary) formattadır. Lütfen indirmeyi kullanın.', 'info');
                return;
            }

            this.openTabs.set(fileKey, {
                rootId: rootId || 'default',
                relPath: normalizedRelPath,
                name: filename,
                content: data.content ?? '',
                isDirty: false,
                modifiedAt: data.modifiedAt,
                language: this.detectLanguage(filename)
            });

            this.switchTab(fileKey);

            // Join real-time room
            window.api.sendWs({
                type: 'collab:join_file',
                rootId: rootId || 'default',
                path: normalizedRelPath
            });

        } catch (err) {
            window.app.showToast(err.message || 'Dosya açılamadı', 'error');
        }
    }

    updateSaveStatusUI(tab) {
        const pill = document.getElementById('save-status-indicator');
        const saveBtn = document.getElementById('btn-editor-save');
        const textEl = document.getElementById('save-status-text');
        const savedIcon = pill?.querySelector('.status-saved-icon');
        const dirtyDot = pill?.querySelector('.status-dirty-dot');

        if (!pill || !saveBtn) return;

        if (!tab) {
            pill.style.display = 'none';
            saveBtn.classList.remove('is-dirty');
            return;
        }

        pill.style.display = 'flex';

        if (tab.isDirty) {
            pill.className = 'save-status-pill dirty';
            if (savedIcon) savedIcon.style.display = 'none';
            if (dirtyDot) dirtyDot.style.display = 'inline-block';
            if (textEl) textEl.textContent = 'Kaydedilmemiş Değişiklikler';
            saveBtn.classList.add('is-dirty');
            saveBtn.title = 'Kaydet (Ctrl+S) - Değişiklikler Var';
        } else {
            pill.className = 'save-status-pill clean';
            if (savedIcon) savedIcon.style.display = 'inline-block';
            if (dirtyDot) dirtyDot.style.display = 'none';
            if (textEl) textEl.textContent = 'Tüm Değişiklikler Kaydedildi';
            saveBtn.classList.remove('is-dirty');
            saveBtn.title = 'Kaydet (Ctrl+S) - Güncel';
        }
    }

    switchTab(fileKey) {
        const tab = this.openTabs.get(fileKey);
        if (!tab) return;

        this.activeTabKey = fileKey;
        this.renderTabs();
        this.renderBreadcrumbs(tab.relPath);
        this.renderEditor(tab);
        this.updateSaveStatusUI(tab);

        const langEl = document.getElementById('status-lang');
        if (langEl) langEl.textContent = tab.language;

        // Notify collab room
        window.api.sendWs({
            type: 'collab:join_file',
            rootId: tab.rootId,
            path: tab.relPath
        });
    }

    closeTab(fileKey, e) {
        if (e) e.stopPropagation();

        this.openTabs.delete(fileKey);
        window.api.sendWs({ type: 'collab:leave_file' });

        if (this.activeTabKey === fileKey) {
            const keys = Array.from(this.openTabs.keys());
            if (keys.length > 0) {
                this.switchTab(keys[keys.length - 1]);
            } else {
                this.activeTabKey = null;
                this.renderTabs();
                this.renderBreadcrumbs('');
                this.renderEmptyState();
                this.updateSaveStatusUI(null);
            }
        } else {
            this.renderTabs();
        }
    }

    renderTabs() {
        const tabsBar = document.getElementById('editor-tabs-bar');
        if (!tabsBar) return;

        tabsBar.innerHTML = '';
        for (const [key, tab] of this.openTabs.entries()) {
            const isActive = key === this.activeTabKey;
            const tabEl = document.createElement('div');
            tabEl.className = `pro-tab ${isActive ? 'active' : ''}`;
            const iconSvg = this.getTabSvgIcon(tab.name);

            tabEl.innerHTML = `
                <div class="tab-icon">${iconSvg}</div>
                <span title="${tab.relPath}">${tab.name}</span>
                ${tab.isDirty ? '<span class="tab-dirty-dot" title="Kaydedilmemiş değişiklikler var"></span>' : ''}
                <button type="button" class="pro-tab-close" title="Sekmeyi Kapat">✕</button>
            `;
            tabEl.onclick = () => this.switchTab(key);
            tabEl.querySelector('.pro-tab-close').onclick = (e) => this.closeTab(key, e);
            tabsBar.appendChild(tabEl);
        }
    }

    renderBreadcrumbs(relPath) {
        const breadcrumbNav = document.getElementById('editor-breadcrumb-nav');
        if (!breadcrumbNav) return;

        if (!relPath) {
            breadcrumbNav.innerHTML = `
                <button type="button" class="breadcrumb-item-btn" id="breadcrumb-root-btn">workspace</button>
                <span class="breadcrumb-separator">/</span>
                <span class="active-file" id="active-file-path">Dosya seçilmedi</span>
            `;
            document.getElementById('breadcrumb-root-btn')?.addEventListener('click', () => {
                window.clientWorkspace?.loadDirectory('');
            });
            return;
        }

        const segments = relPath.split(/[\\/]/);
        const filename = segments.pop();

        let html = `<button type="button" class="breadcrumb-item-btn" data-dir="">workspace</button>`;
        let accumulated = '';

        for (const seg of segments) {
            accumulated = accumulated ? `${accumulated}/${seg}` : seg;
            html += `<span class="breadcrumb-separator">/</span>`;
            html += `<button type="button" class="breadcrumb-item-btn" data-dir="${accumulated}">${seg}</button>`;
        }

        html += `<span class="breadcrumb-separator">/</span>`;
        html += `<span class="active-file" id="active-file-path">${filename}</span>`;

        breadcrumbNav.innerHTML = html;

        breadcrumbNav.querySelectorAll('.breadcrumb-item-btn').forEach(btn => {
            btn.onclick = () => {
                const targetDir = btn.getAttribute('data-dir');
                window.clientWorkspace?.loadDirectory(targetDir);
            };
        });
    }

    renderEditor(tab) {
        const container = this.getContainer();
        if (!container) return;

        // Check user permission (RBAC)
        const canWrite = window.api.user?.role === 'admin' || window.api.user?.permissions?.canWrite !== false;
        const readOnlyBadge = document.getElementById('editor-permission-badge');
        const saveBtn = document.getElementById('btn-editor-save');

        if (readOnlyBadge) {
            readOnlyBadge.style.display = canWrite ? 'none' : 'flex';
        }
        if (saveBtn) {
            saveBtn.disabled = !canWrite;
            saveBtn.style.opacity = canWrite ? '1' : '0.4';
        }

        container.innerHTML = `
            <div class="editor-code-container">
                <div id="line-numbers" class="editor-line-numbers"></div>
                <textarea id="code-textarea" class="editor-textarea-main" spellcheck="false" ${!canWrite ? 'readonly' : ''}></textarea>
            </div>
        `;

        const textarea = document.getElementById('code-textarea');
        const lineNums = document.getElementById('line-numbers');
        if (!textarea || !lineNums) return;

        textarea.value = tab.content;
        this.updateLineNumbers(textarea, lineNums);
        this.applyFontSize();
        this.applyWordWrap();

        if (canWrite) {
            textarea.addEventListener('input', () => {
                if (this.isInternalChange) return;
                tab.content = textarea.value;
                tab.isDirty = true;
                this.renderTabs();
                this.updateSaveStatusUI(tab);
                this.updateLineNumbers(textarea, lineNums);

                // Broadcast real-time change
                window.api.sendWs({
                    type: 'collab:edit',
                    change: { fullContent: textarea.value }
                });
            });
        }

        textarea.addEventListener('scroll', () => {
            lineNums.scrollTop = textarea.scrollTop;
        });

        textarea.addEventListener('keydown', (e) => {
            // Tab support (4 spaces)
            if (e.key === 'Tab' && canWrite) {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 4;
                textarea.dispatchEvent(new Event('input'));
            }
        });

        // Update cursor position in status bar
        textarea.addEventListener('keyup', () => this.updateCursorStatus(textarea));
        textarea.addEventListener('click', () => this.updateCursorStatus(textarea));

        textarea.focus();
    }

    updateLineNumbers(textarea, lineNums) {
        const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
        let numsHtml = '';
        for (let i = 1; i <= lineCount; i++) {
            numsHtml += `${i}<br>`;
        }
        lineNums.innerHTML = numsHtml;
    }

    updateCursorStatus(textarea) {
        const textLines = textarea.value.substring(0, textarea.selectionStart).split('\n');
        const line = textLines.length;
        const col = textLines[textLines.length - 1].length + 1;

        const cursorEl = document.getElementById('status-cursor');
        if (cursorEl) cursorEl.textContent = `Satır ${line}, Sütun ${col}`;

        // Send cursor position to peers
        window.api.sendWs({
            type: 'collab:cursor',
            position: { line, column: col }
        });
    }

    renderEmptyState() {
        const container = this.getContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="empty-canvas-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
                <h4>Düzenlemek için bir dosya seçin</h4>
                <p>Dosyayı kaydetmek için <kbd class="shortcut-kbd">Ctrl</kbd> + <kbd class="shortcut-kbd">S</kbd> kullanabilirsiniz</p>
            </div>
        `;
        const pathEl = document.getElementById('active-file-path');
        if (pathEl) pathEl.textContent = 'Dosya seçilmedi';
        this.updateSaveStatusUI(null);
    }

    renderCollaborators(users) {
        const groupEl = document.getElementById('collaborators-pill-group');
        if (!groupEl) return;

        groupEl.innerHTML = '';
        for (const user of users) {
            const avatar = document.createElement('div');
            avatar.className = 'collaborator-avatar';
            avatar.style.backgroundColor = user.color || '#3b82f6';
            avatar.title = `${user.displayName || user.username} (Satır ${user.cursor?.line || 1})`;
            avatar.textContent = (user.displayName || user.username).substring(0, 2).toUpperCase();
            groupEl.appendChild(avatar);
        }
    }

    async saveCurrentFile() {
        if (!this.activeTabKey) return;
        const tab = this.openTabs.get(this.activeTabKey);
        if (!tab) return;

        if (window.api.user?.role !== 'admin' && window.api.user?.permissions?.canWrite === false) {
            window.app.showToast('Bu dosyayı düzenleme ve kaydetme yetkiniz bulunmuyor.', 'error');
            return;
        }

        try {
            await window.api.writeFile(tab.rootId, tab.relPath, tab.content);
            tab.isDirty = false;
            this.renderTabs();
            this.updateSaveStatusUI(tab);
            window.app.showToast(`"${tab.name}" başarıyla kaydedildi.`, 'success');
        } catch (err) {
            window.app.showToast('Kaydetme hatası: ' + err.message, 'error');
        }
    }
}

window.codeEditor = new CodeEditorManager();
