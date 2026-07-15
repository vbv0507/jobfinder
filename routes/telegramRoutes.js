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
} = require('../controller/telegramController');

router.get('/status', getStatus);
router.get('/statistics', getStatistics);
router.get('/channels', getChannels);
router.patch('/channels/:id/toggle', toggleChannel);
router.post('/channels', addChannel);
router.delete('/channels/:id', deleteChannel);
router.post('/reconnect', reconnect);
router.post('/reload', reload);

module.exports = router;
