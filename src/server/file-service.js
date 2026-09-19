const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

class FileService {
    constructor(db, securityEngine, auditLogger) {
        this.db = db;
        this.security = securityEngine;
        this.auditLogger = auditLogger;
    }

    /**
     * List contents of a directory safely
     */
    async listDirectory(rootId, relPath, user, ip) {
        const fullPath = this.security.resolveSafePath(rootId, relPath, user, 'canRead');

        if (!fs.existsSync(fullPath)) {
            throw new Error('Dizin bulunamadı.');
        }

        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) {
            throw new Error('Belirtilen konum bir dizin değil.');
        }

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = [];

        for (const item of items) {
            const itemPath = path.join(fullPath, item.name);
            const itemRelPath = path.posix.join((relPath || '').replace(/\\/g, '/'), item.name);
            
            try {
                const itemStat = fs.statSync(itemPath);
                result.push({
                    name: item.name,
                    relPath: itemRelPath,
                    isDirectory: item.isDirectory(),
                    size: item.isDirectory() ? 0 : itemStat.size,
                    modifiedAt: itemStat.mtime.toISOString(),
                    mimeType: item.isDirectory() ? 'directory' : (mime.lookup(item.name) || 'application/octet-stream')
                });
            } catch (e) {
                // Ignore unreadable system files
            }
        }

        // Sort folders first, then alphabetical
        result.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            }
            return a.isDirectory ? -1 : 1;
        });

        return {
            currentPath: relPath || '',
            items: result
        };
    }

    /**
     * Read file content (text or base64)
     */
    async readFile(rootId, relPath, user, ip) {
        const fullPath = this.security.resolveSafePath(rootId, relPath, user, 'canRead');

        if (!fs.existsSync(fullPath)) {
            throw new Error('Dosya bulunamadı.');
        }

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            throw new Error('Bu bir klasör, dosya değil.');
        }

        // 20 MB limit for direct text read in editor
        const MAX_TEXT_SIZE = 20 * 1024 * 1024;
        if (stat.size > MAX_TEXT_SIZE) {
            throw new Error('Dosya boyutu çok büyük (Maksimum 20MB açılabilir). Lütfen indirmeyi kullanın.');
        }

        const mimeType = mime.lookup(fullPath) || 'text/plain';
        const buf = fs.readFileSync(fullPath);
        const checkLen = Math.min(buf.length, 4096);
        let isBinary = false;
        for (let i = 0; i < checkLen; i++) {
            if (buf[i] === 0) {
                isBinary = true;
                break;
            }
        }
        const isText = !isBinary;

        this.auditLogger.log({
            username: user.username,
            ip,
            action: 'FILE_READ',
            target: relPath,
            details: `Dosya açıldı (${(stat.size / 1024).toFixed(1)} KB)`
        });

        if (isText) {
            const content = buf.toString('utf8');
            return {
                isText: true,
                content,
                size: stat.size,
                mimeType,
                name: path.basename(fullPath),
                modifiedAt: stat.mtime.toISOString()
            };
        } else {
            return {
                isText: false,
                content: null,
                size: stat.size,
                mimeType,
                name: path.basename(fullPath),
                modifiedAt: stat.mtime.toISOString()
            };
        }
    }

    /**
     * Write / Save file content
     */
    async writeFile(rootId, relPath, content, user, ip) {
        const fullPath = this.security.resolveSafePath(rootId, relPath, user, 'canWrite');

        const isNew = !fs.existsSync(fullPath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf8');
        const stat = fs.statSync(fullPath);

        this.auditLogger.log({
            username: user.username,
            ip,
            action: isNew ? 'FILE_CREATE' : 'FILE_EDIT',
            target: relPath,
            details: `${isNew ? 'Yeni dosya oluşturuldu' : 'Dosya güncellendi'} (${(stat.size / 1024).toFixed(1)} KB)`
        });

        return {
            success: true,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
        };
    }

    /**
     * Create directory
     */
    async createDirectory(rootId, relPath, user, ip) {
        const fullPath = this.security.resolveSafePath(rootId, relPath, user, 'canWrite');

        if (fs.existsSync(fullPath)) {
            throw new Error('Bu isimde bir klasör veya dosya zaten var.');
        }

        fs.mkdirSync(fullPath, { recursive: true });

        this.auditLogger.log({
            username: user.username,
            ip,
            action: 'FOLDER_CREATE',
            target: relPath,
            details: 'Klasör oluşturuldu.'
        });

        return { success: true };
    }

    /**
     * Delete file or directory
     */
    async deleteItem(rootId, relPath, user, ip) {
        const fullPath = this.security.resolveSafePath(rootId, relPath, user, 'canDelete');

        if (!fs.existsSync(fullPath)) {
            throw new Error('Silinecek öğe bulunamadı.');
        }

        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();

        if (isDir) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fullPath);
        }

        this.auditLogger.log({
            username: user.username,
            ip,
            action: isDir ? 'FOLDER_DELETE' : 'FILE_DELETE',
            target: relPath,
            details: isDir ? 'Klasör ve içeriği silindi.' : 'Dosya silindi.'
        });

        return { success: true };
    }

    /**
     * Rename / Move item
     */
    async renameItem(rootId, oldRelPath, newRelPath, user, ip) {
        const oldFullPath = this.security.resolveSafePath(rootId, oldRelPath, user, 'canWrite');
        const newFullPath = this.security.resolveSafePath(rootId, newRelPath, user, 'canWrite');

        const resolvedOld = path.resolve(oldFullPath);
        const resolvedNew = path.resolve(newFullPath);

        if (resolvedOld.toLowerCase() === resolvedNew.toLowerCase()) {
            throw new Error('Kaynak ve hedef konum aynı.');
        }

        if (!fs.existsSync(resolvedOld)) {
            throw new Error('Kaynak dosya veya klasör bulunamadı.');
        }

        const stat = fs.statSync(resolvedOld);

        // Prevent moving a folder into its own subdirectory (circular loop)
        if (stat.isDirectory()) {
            if (resolvedNew.toLowerCase().startsWith(resolvedOld.toLowerCase() + path.sep)) {
                throw new Error('Bir klasör kendi alt dizinlerine taşınamaz.');
            }
        }

        if (fs.existsSync(resolvedNew)) {
            throw new Error('Hedef konumda aynı isimde bir öğe zaten mevcut.');
        }

        const parentDir = path.dirname(resolvedNew);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.renameSync(resolvedOld, resolvedNew);

        const isMove = path.dirname(resolvedOld) !== path.dirname(resolvedNew);
        this.auditLogger.log({
            username: user.username,
            ip,
            action: isMove ? (stat.isDirectory() ? 'FOLDER_MOVE' : 'FILE_MOVE') : 'FILE_RENAME',
            target: `${oldRelPath} -> ${newRelPath}`,
            details: isMove ? 'Öğe klasöre taşındı.' : 'Öğe yeniden adlandırıldı.'
        });

        return { success: true };
    }
}

module.exports = FileService;
