require("dotenv").config();

const mongoose = require("mongoose");
const { client: redisClient } = require("../config/redis");

const requireEnvironment = (names) => {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
};

const runWithDatabase = async (task) => {
  requireEnvironment(["MONGO_URI"]);

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
    return await task();
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (typeof redisClient.quit === "function") await redisClient.quit();
  }
};

const runScript = async (name, task) => {
  try {
    await runWithDatabase(task);
    console.log(`[${name}] Completed.`);
  } catch (error) {
    console.error(`[${name}] Failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
};

module.exports = { requireEnvironment, runWithDatabase, runScript };
