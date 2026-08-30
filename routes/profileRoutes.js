const express = require("express");
const {
    getActiveProfile,
    upsertProfile,
} = require("../controllers/profileController");
const { requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireAdmin, getActiveProfile);
router.post("/", requireAdmin, upsertProfile);
router.put("/", requireAdmin, upsertProfile);

module.exports = router;
