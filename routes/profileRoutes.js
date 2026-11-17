const express = require("express");
const {
    getActiveProfile,
    upsertProfile,
} = require("../controllers/profileController");
const { requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// Public portfolio stats: aggregate counts only, no job or user data.
const PUBLIC_ORIGINS = ["https://vbv.is-a.dev", "http://localhost:8080"];
router.get("/public-stats", async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (PUBLIC_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.lovable\.app$/.test(origin))) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Cache-Control", "public, max-age=300");
    try {
        const { getLifetimeStats } = require("../services/jobStatsService");
        const s = await getLifetimeStats();
        res.json({
            totalScraped: Number(s.totalScrapedLifetime) || 0,
            matchedToProfile: Number(s.totalMatchedToUser) || 0,
            sdeFresher: Number(s.totalSdeFresher) || 0,
            sdeExperienced: Number(s.totalSdeExp) || 0,
            nonSde: Number(s.totalNonSde) || 0,
            matchRate: Number(s.userMatchRate) || 0,
            updatedAt: s.lastCalculatedAt || new Date(),
        });
    } catch (e) {
        res.status(503).json({ error: "Stats unavailable" });
    }
});

router.get("/", requireAdmin, getActiveProfile);
router.post("/", requireAdmin, upsertProfile);
router.put("/", requireAdmin, upsertProfile);

module.exports = router;
