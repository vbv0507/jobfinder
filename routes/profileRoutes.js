const express = require("express");

const {
    getActiveProfile,
    upsertProfile,
} = require("../controller/profileController");

const router = express.Router();

// GET /api/profile -> current active candidate profile
router.get("/", getActiveProfile);

// POST /api/profile -> save a new active candidate profile
router.post("/", upsertProfile);

module.exports = router;
