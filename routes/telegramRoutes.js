const express = require('express');
const router = express.Router();
const {
    getChannels, 
    toggleChannel, 
    addChannel, 
    deleteChannel,
    getStatus,
    getStatistics,
    reconnect,
    reload
} = require('../controllers/telegramController');

const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");



router.get('/status', requireViewer, getStatus);
router.get('/statistics', requireViewer, getStatistics);
router.get('/channels', requireViewer, getChannels);
router.patch('/channels/:id/toggle', requireAdmin, toggleChannel);
router.post('/channels', requireAdmin, addChannel);
router.delete('/channels/:id', requireAdmin, deleteChannel);
router.post('/reconnect', requireAdmin, reconnect);
router.post('/reload', requireAdmin, reload);

// Phase 17: Sync state
router.get('/sync/status', requireViewer, async (req, res) => {
    try {
        const { getSyncStatus } = require('../services/telegramBackfillService');
        const states = await getSyncStatus();
        res.json({ success: true, data: states });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
