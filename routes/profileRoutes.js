const express = require("express");

const {
    getActiveProfile,
    upsertProfile,
} = require("../controller/profileController");

const router = express.Router();


const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");



router.get("/", requireViewer, getActiveProfile);


router.post("/", requireAdmin, upsertProfile);

module.exports = router;
