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
        const CandidateProfile = require('../models/CandidateProfile');
        let profile = null;
        try {
            if (req.user && req.user._id) {
                profile = await CandidateProfile.findOne({ user: req.user._id });
            }
        } catch (e) {}

        console.error('--- AUTHENTICATION FAILURE DEBUG ---');
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        console.error('Stack Trace:', error.stack);
        console.error('Authenticated Clerk userId:', auth.userId);
        console.error('SessionId:', auth.sessionId);
        console.error('Mongo User Document:', req.user || 'Not fetched');
        console.error('CandidateProfile Document:', profile || 'Not fetched/None');
        console.error('res.locals:', res.locals);
        console.error('------------------------------------');

        if (req.originalUrl.startsWith('/api')) {
            return res.status(500).json({ success: false, message: 'Internal Server Error during auth', error: error.message });
        }
        return res.status(500).send(`Authentication failed: ${error.message}`);
    }
    
    next();
};

const isSuperAdminUser = (user) => {
    if (!user) return false;
    if (user.isSystem) return true;
    const email = (user.email || '').toLowerCase().trim();
    return email === 'vbvrai1407@gmail.com' || email.includes('vbvrai1407');
};

const requireAdmin = async (req, res, next) => {
    await requireAuth(req, res, () => {
        if (req.user && req.user.isActive) {
            return next();
        }
        if (req.originalUrl.startsWith('/api')) {
            return res.status(403).json({ success: false, message: 'Forbidden: Access required.' });
        }
        return res.status(403).send('Forbidden: Access required.');
    });
};

const requireSuperAdmin = async (req, res, next) => {
    await requireAuth(req, res, () => {
        if (req.user && isSuperAdminUser(req.user)) {
            return next();
        }
        if (req.originalUrl.startsWith('/api')) {
            return res.status(403).json({ success: false, message: 'Forbidden: Super-Admin access required (vbvrai1407).' });
        }
        return res.status(403).send('Forbidden: Super-Admin access required (vbvrai1407).');
    });
};

const requireViewer = async (req, res, next) => {
    await requireAuth(req, res, () => {
        if (req.user && req.user.isActive) {
            return next();
        }
        if (req.originalUrl.startsWith('/api')) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        return res.status(403).send('Forbidden');
    });
};

const requireExtendedViewer = async (req, res, next) => {
    await requireAuth(req, res, () => {
        if (req.user && req.user.isActive) {
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
    requireSuperAdmin,
    requireViewer,
    requireExtendedViewer,
    isSuperAdminUser
};
