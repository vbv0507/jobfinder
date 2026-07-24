const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require("mongoose");
const Company = require("./models/Company");

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const openai = await Company.findOne({ name: 'OpenAI' });
  const mastercard = await Company.findOne({ name: 'Mastercard' });

  console.log("=== OpenAI ===");
  console.log("ATS:", openai.ats);
  console.log("scraperConfig:", openai.scraperConfig);
  if (openai.latestExecutionTimeline) {
      console.log("Timeline End:", openai.latestExecutionTimeline);
  }

  console.log("\n=== Mastercard ===");
  console.log("ATS:", mastercard.ats);
  console.log("scraperConfig:", mastercard.scraperConfig);
  if (mastercard.latestExecutionTimeline) {
      console.log("Timeline End:", mastercard.latestExecutionTimeline);
  }
  process.exit(0);
}
check();
