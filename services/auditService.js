const AuditLog = require('../models/AuditLog');

const logAuditAction = async (req, action, result) => {
    try {
        let userId = 'system';
        let email = 'system@internal';
        let role = 'system';

        if (req.auth && req.auth.userId) {
            userId = req.auth.userId;
            const claims = req.auth.sessionClaims || {};
            role = (claims.metadata && claims.metadata.role) || 
                   (claims.publicMetadata && claims.publicMetadata.role) || 
                   (claims.public_metadata && claims.public_metadata.role) || 'viewer';
            // email can be extracted if it's in claims, otherwise we leave it as unknown
            email = claims.email || 'unknown';
        }

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const endpoint = req.originalUrl || req.url;

        await AuditLog.create({
            userId,
            email,
            role,
            ip,
            userAgent,
            endpoint,
            action,
            result
        });
    } catch (error) {
        console.error('[Audit Log Error]', error.message);
    }
};

module.exports = { logAuditAction };
