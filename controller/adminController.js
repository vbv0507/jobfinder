const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

const getUsers = async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const promoteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') return res.status(400).json({ error: 'User is already an admin' });

        user.role = 'admin';
        await user.save();

        await AuditLog.create({
            action: 'Role Change',
            user: req.user.email,
            details: `Promoted ${user.email} to Admin`
        });

        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const demoteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'viewer') return res.status(400).json({ error: 'User is already a viewer' });

        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount <= 1) {
            return res.status(400).json({ error: 'Cannot demote the last admin' });
        }

        user.role = 'viewer';
        await user.save();

        await AuditLog.create({
            action: 'Role Change',
            user: req.user.email,
            details: `Demoted ${user.email} to Viewer`
        });

        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const toggleUserStatus = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.role === 'admin' && user.isActive) {
            const adminCount = await User.countDocuments({ role: 'admin', isActive: true });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot deactivate the last active admin' });
            }
        }

        user.isActive = !user.isActive;
        await user.save();

        await AuditLog.create({
            action: user.isActive ? 'Activate User' : 'Deactivate User',
            user: req.user.email,
            details: `${user.isActive ? 'Activated' : 'Deactivated'} ${user.email}`
        });

        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getUsers,
    promoteUser,
    demoteUser,
    toggleUserStatus
};
