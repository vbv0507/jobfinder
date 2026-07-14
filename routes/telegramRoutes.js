const express = require('express');
const router = express.Router();
const { 
    getChannels, 
    toggleChannel, 
    addChannel, 
    deleteChannel 
} = require('../controller/telegramController');

router.get('/channels', getChannels);
router.patch('/channels/:id/toggle', toggleChannel);
router.post('/channels', addChannel);
router.delete('/channels/:id', deleteChannel);

module.exports = router;
