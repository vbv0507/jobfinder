require("dotenv").config();
const mongoose = require("mongoose");
const { client: redisClient } = require("../config/redis");
const { getActiveProfile } = require("../services/pipeline/aiEvaluationService");
const { reconcileMatchedJobs } = require("../services/jobLifecycleService");

async function reconcile() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const profile = await getActiveProfile();
    const stats = await reconcileMatchedJobs(profile);
    console.log("[Matched Jobs Reconciliation]", stats);
  } finally {
    await mongoose.disconnect();
    if (typeof redisClient.quit === "function") await redisClient.quit();
  }
}

reconcile().catch((error) => {
  console.error("[Matched Jobs Reconciliation] Failed:", error.message);
  process.exit(1);
});
