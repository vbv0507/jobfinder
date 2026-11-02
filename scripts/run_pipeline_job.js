const { runScript } = require("./jobRuntime");
const { seedCompanies } = require("../services/companyService");
const runSearch = require("../cron/jobSearchCron");

runScript("GitHub Pipeline", async () => {
  if (process.env.SEED_COMPANIES_ON_JOB !== "false") await seedCompanies();
  await runSearch("GitHub Actions", true);
});
