const { clerkMiddleware: createClerkMiddleware, getAuth } = require('@clerk/express');
const crypto = require('crypto');
const { syncUser } = require('../services/userService');

const clerkMiddleware = createClerkMiddleware();

// Shared logic to verify system tokens
const isSystemRequest = (req) => {
    const systemToken = req.headers['x-system-token'];
    const systemSecret = process.env.SYSTEM_INTERNAL_SECRET;
    
    if (systemToken && systemSecret) {
        if (systemToken.length === systemSecret.length && crypto.timingSafeEqual(Buffer.from(systemToken), Buffer.from(systemSecret))) {
            return true;
        }
    }
    return false;
};

// requireAuth: Verifies Clerk JWT and syncs MongoDB user
const requireAuth = async (req, res, next) => {
    if (isSystemRequest(req)) {
        req.user = { role: 'admin', isSystem: true }; // System gets admin rights automatically
        return next();
    }

    const auth = getAuth(req);
    if (!auth || !auth.userId) {
        if (req.originalUrl.startsWith('/api')) {
            return res.status(401).json({ success: false, message: 'SESSION_EXPIRED' });
        }
        return res.redirect('/login');
    }

    try {
        const user = await syncUser(auth.userId);
        if (!user.isActive) {
            if (req.originalUrl.startsWith('/api')) {
                return res.status(403).json({ success: false, message: 'Account deactivated' });
            }
            return res.status(403).send('Your account has been deactivated.');
        }
        req.user = user;
        // Inject user into locals for EJS
        res.locals.user = user;
    } catch (error) {
        console.error('[AuthMiddleware] Error syncing user:', error);
        if (req.originalUrl.startsWith('/api')) {
            return res.status(500).json({ success: false, message: 'Internal Server Error during auth' });
        }
        return res.status(500).send('Authentication failed.');
    }
    
    next();
};

const requireAdmin = async (req, res, next) => {
    await requireAuth(req, res, () => {
        if (req.user && req.user.role === 'admin') {
            return next();
        }
        if (req.originalUrl.startsWith('/api')) {
            return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
        }
        return res.status(403).send('Forbidden: Admin access required.');
    });
};

const requireViewer = async (req, res, next) => {
    await requireAuth(req, res, () => {
        // Since requireAuth checks isActive, both admin and viewer are allowed
        if (req.user && (req.user.role === 'admin' || req.user.role === 'viewer')) {
            return next();
        }
        if (req.originalUrl.startsWith('/api')) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        return res.status(403).send('Forbidden');
    });
};

module.exports = {
    clerkMiddleware,
    requireAuth,
    requireAdmin,
    requireViewer
};
