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

module.exports = router;
