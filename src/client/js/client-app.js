class ClientWorkspaceManager {
    constructor() {
        this.currentRootId = 'default';
        this.currentPath = '';
        this.selectedItem = null;
    }

    init() {
        this.bindEvents();
        this.checkSavedSession();
    }

    bindEvents() {
        // Connect Hub Form Submit
        const connectForm = document.getElementById('connect-hub-form');
        if (connectForm) {
            connectForm.onsubmit = (e) => this.handleConnect(e);
        }

        // Active Session Card Buttons
        document.getElementById('btn-go-to-workspace')?.addEventListener('click', () => {
            window.app.switchView('client');
        });

        document.getElementById('btn-disconnect-session')?.addEventListener('click', () => {
            this.handleDisconnect();
        });

        // File Explorer Action Buttons
        const btnNewFile = document.getElementById('btn-new-file');
        if (btnNewFile) {
            btnNewFile.onclick = () => this.openFileActionModal('file');
        }

        const btnNewFolder = document.getElementById('btn-new-folder');
        if (btnNewFolder) {
            btnNewFolder.onclick = () => this.openFileActionModal('folder');
        }

        const btnUpload = document.getElementById('btn-upload-file');
        const fileInput = document.getElementById('file-upload-input');
        if (btnUpload && fileInput) {
            btnUpload.onclick = () => fileInput.click();
            fileInput.onchange = (e) => {
                this.handleUploadFiles(e.target.files);
                fileInput.value = '';
            };
        }

        const btnRefreshFiles = document.getElementById('btn-refresh-files');
        if (btnRefreshFiles) {
            btnRefreshFiles.onclick = () => this.loadDirectory(this.currentPath);
        }

        // File Action Modal Form Submit
        const fileActionForm = document.getElementById('file-action-form');
        if (fileActionForm) {
            fileActionForm.onsubmit = (e) => this.handleFileActionSubmit(e);
        }

        this.setupContextMenu();
        this.setupDragAndDrop();
        this.setupExplorerFilter();
    }

    setupExplorerFilter() {
        const filterInput = document.getElementById('explorer-filter-input');
        const clearBtn = document.getElementById('btn-clear-explorer-filter');
        if (!filterInput) return;

        const applyFilter = () => {
            const query = filterInput.value.trim().toLowerCase();
            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            const nodes = document.querySelectorAll('#file-tree .pro-tree-node');
            let matchCount = 0;

            nodes.forEach(node => {
                const isBack = node.textContent.includes('.. (Üst Dizin)');
                if (isBack) {
                    node.style.display = 'flex';
                    return;
                }

                const name = node.querySelector('.node-name')?.textContent.toLowerCase() || '';
                if (!query || name.includes(query)) {
                    node.style.display = 'flex';
                    matchCount++;
                } else {
                    node.style.display = 'none';
                }
            });

            let noMatchEl = document.getElementById('tree-no-match-notice');
            if (query && matchCount === 0) {
                if (!noMatchEl) {
                    noMatchEl = document.createElement('div');
                    noMatchEl.id = 'tree-no-match-notice';
                    noMatchEl.style.cssText = 'padding: 14px; font-size: 11px; color: var(--text-tertiary); text-align: center;';
                    document.getElementById('file-tree')?.appendChild(noMatchEl);
                }
                noMatchEl.textContent = `"${query}" ile eşleşen öğe bulunamadı.`;
                noMatchEl.style.display = 'block';
            } else if (noMatchEl) {
                noMatchEl.style.display = 'none';
            }
        };

        filterInput.addEventListener('input', applyFilter);

        filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                filterInput.value = '';
                applyFilter();
                filterInput.blur();
            }
        });

        if (clearBtn) {
            clearBtn.onclick = () => {
                filterInput.value = '';
                applyFilter();
                filterInput.focus();
            };
        }
    }

    setupDragAndDrop() {
        const dropZones = [document.getElementById('file-tree'), document.getElementById('editor-content-area')];

        dropZones.forEach(zone => {
            if (!zone) return;
            zone.ondragover = (e) => {
                e.preventDefault();
                zone.style.outline = '2px dashed var(--primary)';
            };
            zone.ondragleave = (e) => {
                e.preventDefault();
                zone.style.outline = 'none';
            };
            zone.ondrop = (e) => {
                e.preventDefault();
                zone.style.outline = 'none';
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.handleUploadFiles(e.dataTransfer.files);
                }
            };
        });
    }

    setupContextMenu() {
        const menu = document.getElementById('file-context-menu');
        document.addEventListener('click', () => {
            if (menu) menu.style.display = 'none';
        });

        document.getElementById('ctx-open')?.addEventListener('click', () => {
            if (this.selectedItem) {
                const targetPath = this.selectedItem.relPath || (this.currentPath ? `${this.currentPath}/${this.selectedItem.name}` : this.selectedItem.name);
                if (this.selectedItem.isDirectory) {
                    this.loadDirectory(targetPath);
                } else {
                    window.codeEditor.openFile(this.currentRootId, targetPath);
                }
            }
        });

        document.getElementById('ctx-download')?.addEventListener('click', () => {
            if (this.selectedItem && !this.selectedItem.isDirectory) {
                const url = window.api.getDownloadUrl(this.currentRootId, this.selectedItem.relPath);
                const a = document.createElement('a');
                a.href = url;
                a.download = this.selectedItem.name;
                a.click();
            }
        });

        document.getElementById('ctx-rename')?.addEventListener('click', () => {
            if (this.selectedItem) {
                this.openFileActionModal('rename', this.selectedItem);
            }
        });

        document.getElementById('ctx-delete')?.addEventListener('click', () => {
            if (this.selectedItem) {
                if (confirm(`"${this.selectedItem.name}" silinsin mi?`)) {
                    window.api.deleteItem(this.currentRootId, this.selectedItem.relPath)
                        .then(() => {
                            window.app.showToast('Silindi.', 'success');
                            this.loadDirectory(this.currentPath);
                        })
                        .catch(err => window.app.showToast(err.message, 'error'));
                }
            }
        });
    }

    openFileActionModal(actionType, item = null) {
        const modal = document.getElementById('file-action-modal');
        const titleEl = document.getElementById('file-action-modal-title');
        const labelEl = document.getElementById('file-action-label');
        const inputEl = document.getElementById('file-action-input');
        const typeEl = document.getElementById('file-action-type');
        const oldPathEl = document.getElementById('file-action-oldpath');
        const submitBtn = document.getElementById('file-action-submit-btn');

        if (!modal || !inputEl) return;

        typeEl.value = actionType;

        if (actionType === 'file') {
            titleEl.textContent = 'Yeni Dosya Oluştur';
            labelEl.textContent = 'Dosya Adı ve Uzantısı';
            inputEl.placeholder = 'örn: index.html, script.js, config.json';
            inputEl.value = '';
            oldPathEl.value = '';
            submitBtn.textContent = 'Dosya Oluştur';
        } else if (actionType === 'folder') {
            titleEl.textContent = 'Yeni Klasör Oluştur';
            labelEl.textContent = 'Klasör Adı';
            inputEl.placeholder = 'örn: components, assets, api';
            inputEl.value = '';
            oldPathEl.value = '';
            submitBtn.textContent = 'Klasör Oluştur';
        } else if (actionType === 'rename' && item) {
            titleEl.textContent = 'Yeniden Adlandır';
            labelEl.textContent = 'Yeni İsim';
            inputEl.placeholder = item.name;
            inputEl.value = item.name;
            oldPathEl.value = item.relPath;
            submitBtn.textContent = 'Kaydet';
        }

        modal.classList.add('active');
        setTimeout(() => {
            inputEl.focus();
            inputEl.select();
        }, 50);
    }

    async handleFileActionSubmit(e) {
        e.preventDefault();
        const actionType = document.getElementById('file-action-type').value;
        const inputEl = document.getElementById('file-action-input');
        const name = inputEl.value.trim();
        const modal = document.getElementById('file-action-modal');

        if (!name) return;

        try {
            if (actionType === 'file') {
                const fullRelPath = this.currentPath ? `${this.currentPath}/${name}` : name;
                await window.api.writeFile(this.currentRootId, fullRelPath, '');
                window.app.showToast(`"${name}" dosyası oluşturuldu.`, 'success');
                modal.classList.remove('active');
                await this.loadDirectory(this.currentPath);
                window.codeEditor.openFile(this.currentRootId, fullRelPath);

            } else if (actionType === 'folder') {
                const fullRelPath = this.currentPath ? `${this.currentPath}/${name}` : name;
                await window.api.createFolder(this.currentRootId, fullRelPath);
                window.app.showToast(`"${name}" klasörü oluşturuldu.`, 'success');
                modal.classList.remove('active');
                await this.loadDirectory(this.currentPath);

            } else if (actionType === 'rename') {
                const oldRelPath = document.getElementById('file-action-oldpath').value;
                const dir = oldRelPath.includes('/') ? oldRelPath.substring(0, oldRelPath.lastIndexOf('/')) : '';
                const newRelPath = dir ? `${dir}/${name}` : name;
                await window.api.renameItem(this.currentRootId, oldRelPath, newRelPath);
                window.app.showToast('Öğe yeniden adlandırıldı.', 'success');
                modal.classList.remove('active');
                await this.loadDirectory(this.currentPath);
            }
        } catch (err) {
            window.app.showToast(err.message || 'İşlem başarısız', 'error');
        }
    }

    async checkSavedSession() {
        const savedHost = localStorage.getItem('vds_host');
        const savedPort = localStorage.getItem('vds_port');

        if (savedHost) document.getElementById('connect-host').value = savedHost;
        if (savedPort) document.getElementById('connect-port').value = savedPort;

        if (window.api.token && savedHost && savedPort) {
            window.api.setServerUrl(savedHost, savedPort);
            try {
                const me = await window.api.getMe();
                this.onLoginSuccess(me.user, `${savedHost}:${savedPort}`);
            } catch {
                window.app.updateConnectionStatus(false);
            }
        } else {
            window.app.updateConnectionStatus(false);
        }
    }

    async handleConnect(e) {
        e.preventDefault();
        const host = document.getElementById('connect-host').value.trim();
        const port = document.getElementById('connect-port').value.trim();
        const username = document.getElementById('connect-username').value.trim();
        const pwInput = document.getElementById('connect-password');
        const password = pwInput ? pwInput.value : '';

        window.api.setServerUrl(host, port);
        const submitBtn = document.getElementById('btn-connect-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Bağlanılıyor...</span>';

        try {
            const res = await window.api.login(username, password);
            localStorage.setItem('vds_host', host);
            localStorage.setItem('vds_port', port);

            // Clean password from DOM input for security
            if (pwInput) pwInput.value = '';

            window.app.showToast(`Zenxy bağlantısı sağlandı! Hoş geldiniz, ${res.user.displayName || res.user.username}.`, 'success');
            this.onLoginSuccess(res.user, `${host}:${port}`);
            
            // Seamlessly open Workspace view
            window.app.switchView('client');
        } catch (err) {
            window.app.showToast('Bağlantı hatası: ' + err.message, 'error');
            window.app.updateConnectionStatus(false);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Zenxy'ye Bağlan & Çalışma Alanını Aç</span>
            `;
        }
    }

    async handleDisconnect() {
        await window.api.logout();
        window.app.updateConnectionStatus(false);
        window.app.showToast('Zenxy oturumu sonlandırıldı.', 'info');
        window.app.switchView('connect');

        // Reset workspace state & clean credentials inputs
        const userInp = document.getElementById('connect-username');
        const pwInp = document.getElementById('connect-password');
        if (userInp) userInp.value = '';
        if (pwInp) pwInp.value = '';

        const treeEl = document.getElementById('file-tree');
        if (treeEl) treeEl.innerHTML = '';
        window.codeEditor.renderEmptyState();
    }

    onLoginSuccess(user, serverAddress = '') {
        window.app.updateConnectionStatus(true, user, serverAddress);
        this.applyUserPermissions(user);

        const userBadge = document.getElementById('client-current-user');
        if (userBadge) {
            userBadge.innerHTML = `
                <span style="width:6px; height:6px; border-radius:50%; background:var(--emerald);"></span>
                <span>${user.displayName || user.username}</span>
            `;
        }

        window.codeEditor.init(document.getElementById('editor-content-area'));
        window.codeEditor.renderEmptyState();
        window.remoteTerminal.init(document.getElementById('terminal-content-area'));

        this.loadDirectory('');
    }

    applyUserPermissions(user) {
        if (!user) return;
        const isAdmin = user.role === 'admin';
        const perms = user.permissions || {};

        const canWrite = isAdmin || perms.canWrite !== false;
        const canDelete = isAdmin || perms.canDelete === true;
        const canTerminal = isAdmin || perms.canTerminal === true;

        // Tree action buttons
        const btnNewFile = document.getElementById('btn-new-file');
        const btnNewFolder = document.getElementById('btn-new-folder');
        const btnUpload = document.getElementById('btn-upload-file');

        [btnNewFile, btnNewFolder, btnUpload].forEach(btn => {
            if (btn) {
                if (canWrite) {
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                } else {
                    btn.style.opacity = '0.35';
                    btn.style.pointerEvents = 'none';
                    btn.title = '🔒 Yazma / Dosya Oluşturma Yetkisi Yok';
                }
            }
        });

        // Delete context menu item
        const ctxDelete = document.getElementById('ctx-delete');
        if (ctxDelete) {
            if (canDelete) {
                ctxDelete.style.opacity = '1';
                ctxDelete.style.pointerEvents = 'auto';
                ctxDelete.textContent = 'Sil';
            } else {
                ctxDelete.style.opacity = '0.4';
                ctxDelete.style.pointerEvents = 'none';
                ctxDelete.textContent = '🔒 Sil (Yetki Yok)';
            }
        }

        // Terminal togglers
        const btnToggleTerm = document.getElementById('btn-toggle-docked-term');
        const btnEditorTerm = document.getElementById('btn-editor-term');
        if (btnToggleTerm) {
            btnToggleTerm.style.opacity = canTerminal ? '1' : '0.4';
            btnToggleTerm.title = canTerminal ? 'Terminali Göster/Gizle (Ctrl+`)' : '🔒 Terminal Yetkisi Yok';
        }
        if (btnEditorTerm) {
            btnEditorTerm.style.opacity = canTerminal ? '1' : '0.4';
            btnEditorTerm.disabled = !canTerminal;
            btnEditorTerm.title = canTerminal ? 'VDS PowerShell Konsolunu Aç/Kapat (Ctrl+`)' : '🔒 Terminal Yetkisi Yok';
        }
    }

    async loadDirectory(relPath = '') {
        this.currentPath = relPath;
        const treeEl = document.getElementById('file-tree');
        if (!treeEl) return;

        // Update Explorer Path Bar Header
        const pathTextEl = document.getElementById('explorer-current-path-text');
        if (pathTextEl) {
            pathTextEl.textContent = relPath ? `/${relPath}` : '/ (Kök Dizin)';
            pathTextEl.title = relPath ? `Konum: /${relPath}` : 'Konum: Kök Dizin';
        }

        treeEl.innerHTML = '<div style="padding:14px; color:var(--text-tertiary); font-size:11px;">Yükleniyor...</div>';

        // Update editor breadcrumbs if no file is currently active
        if (!window.codeEditor.activeTabKey) {
            window.codeEditor.renderBreadcrumbs(relPath ? `${relPath}/` : '');
        }

        try {
            const data = await window.api.listFiles(this.currentRootId, relPath);
            treeEl.innerHTML = '';

            const canDelete = window.api.user?.role === 'admin' || window.api.user?.permissions?.canDelete === true;
            const canWrite = window.api.user?.role === 'admin' || window.api.user?.permissions?.canWrite !== false;

            if (relPath) {
                const parentPath = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';
                const backItem = document.createElement('div');
                backItem.className = 'pro-tree-node is-folder';
                backItem.innerHTML = `
                    <div class="node-icon-pro">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    </div>
                    <div class="node-name" style="font-weight:600; color:var(--text-secondary);">.. (Üst Dizin)</div>
                `;
                backItem.onclick = () => this.loadDirectory(parentPath);

                // Drag & Drop to Parent Directory
                if (canWrite) {
                    backItem.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        backItem.classList.add('drop-target-hover');
                        e.dataTransfer.dropEffect = 'move';
                    });
                    backItem.addEventListener('dragleave', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        backItem.classList.remove('drop-target-hover');
                    });
                    backItem.addEventListener('drop', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        backItem.classList.remove('drop-target-hover');

                        // Internal move
                        let jsonData = null;
                        try {
                            const raw = e.dataTransfer.getData('application/json');
                            if (raw) jsonData = JSON.parse(raw);
                        } catch {}

                        if (jsonData && jsonData.type === 'vds_item') {
                            const sourceRelPath = jsonData.relPath;
                            const itemName = jsonData.name;
                            const newRelPath = parentPath ? `${parentPath}/${itemName}` : itemName;

                            if (sourceRelPath === newRelPath) return;

                            try {
                                await window.api.renameItem(this.currentRootId, sourceRelPath, newRelPath);
                                window.app.showToast(`"${itemName}" üst dizine taşındı.`, 'success');
                                await this.loadDirectory(this.currentPath);
                            } catch (err) {
                                window.app.showToast('Taşıma hatası: ' + err.message, 'error');
                            }
                            return;
                        }

                        // External OS file drop
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            try {
                                window.app.showToast(`${e.dataTransfer.files.length} dosya üst dizine yükleniyor...`, 'info');
                                await window.api.uploadFiles(this.currentRootId, parentPath, e.dataTransfer.files);
                                window.app.showToast('Dosyalar üst dizine başarıyla yüklendi.', 'success');
                                await this.loadDirectory(this.currentPath);
                            } catch (err) {
                                window.app.showToast('Yükleme hatası: ' + err.message, 'error');
                            }
                        }
                    });
                }

                treeEl.appendChild(backItem);
            }

            if (!data.items || data.items.length === 0) {
                const empty = document.createElement('div');
                empty.style.padding = '14px';
                empty.style.color = 'var(--text-tertiary)';
                empty.style.fontSize = '11px';
                empty.textContent = 'Dizin boş. Yeni dosya oluşturabilir veya sürükleyip bırakabilirsiniz.';
                treeEl.appendChild(empty);
                return;
            }

            for (const item of data.items) {
                const itemEl = document.createElement('div');
                itemEl.className = `pro-tree-node ${item.isDirectory ? 'is-folder' : 'is-file'}`;
                const iconSvg = this.getFileSvgIcon(item.name, item.isDirectory);
                
                itemEl.innerHTML = `
                    <div class="node-icon-pro">${iconSvg}</div>
                    <div class="node-name" title="${item.name}">${item.name}</div>
                    ${!item.isDirectory ? `<span class="node-meta">${this.formatSize(item.size)}</span>` : ''}
                    <div class="node-actions-hover">
                        ${!item.isDirectory ? `
                            <button type="button" class="node-mini-btn btn-quick-dl" title="İndir">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </button>
                        ` : ''}
                        ${canDelete ? `
                            <button type="button" class="node-mini-btn btn-quick-del" title="Sil" style="color:var(--rose);">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        ` : ''}
                    </div>
                `;

                // Dragging Support
                if (canWrite) {
                    itemEl.draggable = true;
                    itemEl.addEventListener('dragstart', (e) => {
                        itemEl.classList.add('is-dragging');
                        const payload = {
                            type: 'vds_item',
                            relPath: item.relPath || (this.currentPath ? `${this.currentPath}/${item.name}` : item.name),
                            name: item.name,
                            isDirectory: !!item.isDirectory
                        };
                        e.dataTransfer.setData('application/json', JSON.stringify(payload));
                        e.dataTransfer.setData('text/plain', payload.relPath);
                        e.dataTransfer.effectAllowed = 'move';
                    });

                    itemEl.addEventListener('dragend', () => {
                        itemEl.classList.remove('is-dragging');
                        document.querySelectorAll('.pro-tree-node').forEach(n => n.classList.remove('drop-target-hover'));
                    });

                    // Drop Target for Folders
                    if (item.isDirectory) {
                        itemEl.addEventListener('dragover', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            itemEl.classList.add('drop-target-hover');
                            e.dataTransfer.dropEffect = 'move';
                        });

                        itemEl.addEventListener('dragleave', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            itemEl.classList.remove('drop-target-hover');
                        });

                        itemEl.addEventListener('drop', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            itemEl.classList.remove('drop-target-hover');

                            const destDir = item.relPath || (this.currentPath ? `${this.currentPath}/${item.name}` : item.name);

                            // Check internal drag
                            let jsonData = null;
                            try {
                                const raw = e.dataTransfer.getData('application/json');
                                if (raw) jsonData = JSON.parse(raw);
                            } catch {}

                            if (jsonData && jsonData.type === 'vds_item') {
                                const sourceRelPath = jsonData.relPath;
                                const itemName = jsonData.name;
                                const newRelPath = `${destDir}/${itemName}`;

                                if (sourceRelPath === destDir || sourceRelPath === newRelPath) {
                                    return;
                                }

                                try {
                                    await window.api.renameItem(this.currentRootId, sourceRelPath, newRelPath);
                                    window.app.showToast(`"${itemName}" -> "${item.name}" klasörüne taşındı.`, 'success');
                                    await this.loadDirectory(this.currentPath);
                                } catch (err) {
                                    window.app.showToast('Taşıma hatası: ' + err.message, 'error');
                                }
                                return;
                            }

                            // Check external OS file drop
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                try {
                                    window.app.showToast(`${e.dataTransfer.files.length} dosya "${item.name}" içine yükleniyor...`, 'info');
                                    await window.api.uploadFiles(this.currentRootId, destDir, e.dataTransfer.files);
                                    window.app.showToast(`Dosyalar "${item.name}" klasörüne başarıyla yüklendi.`, 'success');
                                    await this.loadDirectory(this.currentPath);
                                } catch (err) {
                                    window.app.showToast('Yükleme hatası: ' + err.message, 'error');
                                }
                            }
                        });
                    }
                }

                // Quick download
                itemEl.querySelector('.btn-quick-dl')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = window.api.getDownloadUrl(this.currentRootId, item.relPath);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = item.name;
                    a.click();
                });

                // Quick delete
                itemEl.querySelector('.btn-quick-del')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`"${item.name}" silinsin mi?`)) {
                        window.api.deleteItem(this.currentRootId, item.relPath)
                            .then(() => {
                                window.app.showToast('Silindi.', 'success');
                                this.loadDirectory(this.currentPath);
                            })
                            .catch(err => window.app.showToast(err.message, 'error'));
                    }
                });

                itemEl.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.pro-tree-node').forEach(el => el.classList.remove('active'));
                    itemEl.classList.add('active');
                    this.selectedItem = item;

                    const targetPath = item.relPath || (this.currentPath ? `${this.currentPath}/${item.name}` : item.name);

                    if (item.isDirectory) {
                        this.loadDirectory(targetPath);
                    } else {
                        window.codeEditor.openFile(this.currentRootId, targetPath);
                    }
                };

                itemEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectedItem = item;
                    const menu = document.getElementById('file-context-menu');
                    if (menu) {
                        menu.style.display = 'block';
                        menu.style.left = `${e.clientX}px`;
                        menu.style.top = `${e.clientY}px`;
                    }
                };

                treeEl.appendChild(itemEl);
            }

            const filterInput = document.getElementById('explorer-filter-input');
            if (filterInput && filterInput.value.trim()) {
                filterInput.dispatchEvent(new Event('input'));
            }
        } catch (err) {
            treeEl.innerHTML = `<div style="padding:14px; color:var(--rose); font-size:11px;">Hata: ${err.message}</div>`;
        }
    }

    getFileSvgIcon(filename = '', isDirectory = false) {
        if (isDirectory) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        }

        const lowerName = (filename || '').toLowerCase();
        const hasExt = lowerName.includes('.');
        const ext = hasExt ? lowerName.split('.').pop() : '';

        // Exact match special filenames
        if (lowerName === 'dockerfile' || lowerName.startsWith('docker-compose')) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M2 12h20M2 12a10 10 0 0 0 18 6.5M2 12a10 10 0 0 1 18-6.5"/><rect x="5" y="8" width="3" height="3" fill="#38bdf8"/><rect x="9" y="8" width="3" height="3" fill="#38bdf8"/><rect x="13" y="8" width="3" height="3" fill="#38bdf8"/><rect x="9" y="5" width="3" height="3" fill="#38bdf8"/></svg>`;
        }

        if (lowerName === 'package.json' || lowerName === 'package-lock.json') {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#ef4444"/><text x="3" y="15" fill="#fff" font-family="monospace" font-size="8.5" font-weight="900">npm</text></svg>`;
        }

        if (lowerName.startsWith('.git')) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;
        }

        if (lowerName.startsWith('.env')) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        }

        if (lowerName.startsWith('license')) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`;
        }

        if (lowerName.startsWith('readme')) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
        }

        // Extension matches
        if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#facc15"/><text x="4" y="16" fill="#000" font-family="monospace" font-size="10" font-weight="900">JS</text></svg>`;
        }

        if (['ts', 'tsx', 'mts'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#0284c7"/><text x="4" y="16" fill="#fff" font-family="monospace" font-size="10" font-weight="900">TS</text></svg>`;
        }

        if (['html', 'htm', 'xhtml'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
        }

        if (['css', 'scss', 'sass', 'less'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`;
        }

        if (['json', 'jsonc', 'json5'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M7 4a3 3 0 0 0-3 3v2a3 3 0 0 1-3 3 3 3 0 0 1 3 3v2a3 3 0 0 0 3 3M17 4a3 3 0 0 1 3 3v2a3 3 0 0 0 3 3 3 3 0 0 0-3 3v2a3 3 0 0 1-3 3"/></svg>`;
        }

        if (['txt', 'log', 'out', 'text'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
        }

        if (['md', 'markdown', 'mdown'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 15V9l3 3 3-3v6"/><path d="M18 12l-2 3-2-3"/></svg>`;
        }

        if (['py', 'pyw', 'ipynb'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#10b981"/><text x="4" y="16" fill="#fff" font-family="monospace" font-size="10" font-weight="900">PY</text></svg>`;
        }

        if (['php'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#818cf8"/><text x="2" y="15" fill="#fff" font-family="monospace" font-size="8.5" font-weight="900">PHP</text></svg>`;
        }

        if (['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#6366f1"/><text x="3" y="16" fill="#fff" font-family="monospace" font-size="9.5" font-weight="900">C++</text></svg>`;
        }

        if (['cs'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#9333ea"/><text x="4" y="16" fill="#fff" font-family="monospace" font-size="10" font-weight="900">C#</text></svg>`;
        }

        if (['rs'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#ea580c"/><text x="4" y="16" fill="#fff" font-family="monospace" font-size="10" font-weight="900">RS</text></svg>`;
        }

        if (['go'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#00add8"/><text x="4" y="16" fill="#fff" font-family="monospace" font-size="10" font-weight="900">GO</text></svg>`;
        }

        if (['sql', 'sqlite', 'db', 'prisma'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`;
        }

        if (['ps1', 'psm1', 'sh', 'bash', 'zsh', 'bat', 'cmd'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
        }

        if (['yml', 'yaml', 'toml', 'ini', 'xml', 'conf', 'config', 'properties'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        }

        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        }

        if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
        }

        if (['pdf'].includes(ext)) {
            return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect width="20" height="20" x="2" y="2" rx="3" fill="#ef4444"/><text x="2" y="15" fill="#fff" font-family="monospace" font-size="8.5" font-weight="900">PDF</text></svg>`;
        }

        // Default file icon (for files without extension or unknown extensions)
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    }

    formatSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async handleUploadFiles(files) {
        if (!files || files.length === 0) return;
        window.app.showToast(`${files.length} dosya yükleniyor...`, 'info');

        try {
            await window.api.uploadFiles(this.currentRootId, this.currentPath, files);
            window.app.showToast(`${files.length} dosya başarıyla yüklendi!`, 'success');
            this.loadDirectory(this.currentPath);
        } catch (err) {
            window.app.showToast('Yükleme hatası: ' + err.message, 'error');
        }
    }
}

window.clientWorkspace = new ClientWorkspaceManager();
