const express = require("express");

const {
    getActiveProfile,
    upsertProfile,
} = require("../controllers/profileController");

const router = express.Router();


const { requireAdmin } = require("../middleware/authMiddleware");



router.get("/", requireAdmin, getActiveProfile);


router.post("/", requireAdmin, upsertProfile);

module.exports = router;
