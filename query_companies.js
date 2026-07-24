const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require("mongoose");
const Company = require("./models/Company");

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const companies = await Company.find({});
  
  let workday = [], greenhouse = [], lever = [], smartrecruiters = [];
  
  for (const c of companies) {
      const ats = (c.ats || '').toLowerCase();
      if (ats === 'workday') workday.push(c.name);
      else if (ats === 'greenhouse') greenhouse.push(c.name);
      else if (ats === 'lever') lever.push(c.name);
      else if (ats === 'smartrecruiters') smartrecruiters.push(c.name);
  }
  
  console.log("Workday:", workday.slice(0, 3));
  console.log("Greenhouse:", greenhouse.slice(0, 3));
  console.log("Lever:", lever.slice(0, 3));
  console.log("SmartRecruiters:", smartrecruiters.slice(0, 3));
  
  process.exit(0);
}
check();
