const { runScript } = require("./jobRuntime");
const { runRawQueuePipeline } = require("../services/pipeline/rawQueueService");
const { verifyLocalJobs } = require("../services/schedulerService");
const { processBatchEmail } = require("../services/emailService");

runScript("GitHub Daily Digest", async () => {
  await runRawQueuePipeline();
  await verifyLocalJobs();
  await processBatchEmail();
});
