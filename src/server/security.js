const path = require('path');
const fs = require('fs');

class SecurityEngine {
    constructor(db) {
        this.db = db;
    }

    /**
     * Resolves and strictly validates that a requested relative path stays within allowed shared roots.
     * Prevents all path traversal attacks (../, %2e%2e, absolute drive escapes, null bytes, etc.)
     * 
     * @param {string} rootId - ID of the shared root (e.g. 'default')
     * @param {string} relativePath - The requested relative path
     * @param {object} user - The authenticated user object
     * @param {string} requiredPermission - Permission flag (e.g. 'canRead', 'canWrite', 'canDelete')
     * @returns {string} - Safe resolved absolute path on the VDS file system
     */
    resolveSafePath(rootId = 'default', relativePath = '', user = null, requiredPermission = 'canRead') {
        if (!user) {
            throw new Error('Erişim reddedildi: Kimlik doğrulanmadı.');
        }

        const config = this.db.getConfig();
        const roots = config.sharedRoots || [];
        const targetRoot = roots.find(r => r.id === rootId) || roots[0];

        if (!targetRoot || !targetRoot.path) {
            throw new Error('Geçersiz paylaşım kök dizini.');
        }

        const rootBasePath = path.resolve(targetRoot.path);

        // Check if user has permission for this root/folder
        if (user.role !== 'admin') {
            // Check general permission
            if (requiredPermission && !user.permissions[requiredPermission]) {
                throw new Error(`Yetki yetersiz: Bu işlem için '${requiredPermission}' izni gerekiyor.`);
            }

            // Check folder scope
            if (!user.permissions.allFolders) {
                const allowedFolders = user.permissions.allowedFolders || [];
                const normRel = path.normalize(relativePath || '').replace(/^[\\\/]+/, '');
                const isAllowed = allowedFolders.some(folder => {
                    const normAllowed = path.normalize(folder).replace(/^[\\\/]+/, '');
                    return normRel === normAllowed || normRel.startsWith(normAllowed + path.sep) || normRel.startsWith(normAllowed + '/');
                });

                if (!isAllowed) {
                    throw new Error('Erişim engellendi: Bu klasöre erişim izniniz bulunmuyor.');
                }
            }
        }

        // Sanitize relative path (remove null bytes, normalize)
        const cleanRelPath = (relativePath || '').replace(/\0/g, '');
        const targetFullPath = path.resolve(rootBasePath, cleanRelPath);

        // Strict jail check: targetFullPath must start with rootBasePath
        const relativeToRoot = path.relative(rootBasePath, targetFullPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            throw new Error('GÜVENLİK İHLALİ: Dizin dışına çıkma girişimi engellendi (Path Traversal)!');
        }

        // Additional Windows canonical drive check
        if (process.platform === 'win32') {
            const rootDrive = path.parse(rootBasePath).root.toLowerCase();
            const targetDrive = path.parse(targetFullPath).root.toLowerCase();
            if (rootDrive !== targetDrive) {
                throw new Error('GÜVENLİK İHLALİ: Farklı sürücüye erişim engellendi!');
            }
        }

        return targetFullPath;
    }

    /**
     * Sanitizes filenames to prevent forbidden OS characters
     */
    sanitizeFilename(name) {
        if (!name || typeof name !== 'string') return 'unnamed';
        // Remove null bytes, slashes, backslashes, colons, wildcards
        return name
            .replace(/[\/\?<>\\:\*\|":]/g, '_')
            .replace(/\0/g, '')
            .trim();
    }

    /**
     * Verifies if user has specific permission
     */
    checkPermission(user, permissionName) {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return !!user.permissions?.[permissionName];
    }
}

/**
 * In-Memory Layer-7 Sliding Window Rate Limiter
 * Protects against API Flooding, DoS spamming, and resource exhaustion.
 */
class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 150) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.hits = new Map();

        // Cleanup expired records every 2 minutes
        this.cleanupTimer = setInterval(() => this.cleanup(), 120000);
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    isAllowed(ip) {
        const now = Date.now();
        const timestamps = this.hits.get(ip) || [];
        const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

        if (validTimestamps.length >= this.maxRequests) {
            this.hits.set(ip, validTimestamps);
            return false;
        }

        validTimestamps.push(now);
        this.hits.set(ip, validTimestamps);
        return true;
    }

    cleanup() {
        const now = Date.now();
        for (const [ip, timestamps] of this.hits.entries()) {
            const valid = timestamps.filter(t => now - t < this.windowMs);
            if (valid.length === 0) {
                this.hits.delete(ip);
            } else {
                this.hits.set(ip, valid);
            }
        }
    }
}

module.exports = SecurityEngine;
module.exports.RateLimiter = RateLimiter;
