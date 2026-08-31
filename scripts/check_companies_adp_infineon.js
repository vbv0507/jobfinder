require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const seedCompanies = require('../utils/companies');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Check in utils/companies.js (seed list)
    const adpSeed = seedCompanies.filter(c => c.name && /adp/i.test(c.name));
    const infineonSeed = seedCompanies.filter(c => c.name && /infin|infon/i.test(c.name));

    console.log("=== SEED FILE (utils/companies.js) ===");
    console.log("ADP in Seed File:", adpSeed);
    console.log("Infineon in Seed File:", infineonSeed);

    // Check in MongoDB
    const adpDb = await Company.find({ name: { $regex: /adp/i } });
    const infineonDb = await Company.find({ name: { $regex: /infin|infon/i } });

    console.log("\n=== DATABASE (MongoDB Company Collection) ===");
    console.log("ADP in DB:", adpDb.map(c => ({ id: c._id, name: c.name, careerUrl: c.careerUrl, active: c.active })));
    console.log("Infineon in DB:", infineonDb.map(c => ({ id: c._id, name: c.name, careerUrl: c.careerUrl, active: c.active })));

    await mongoose.connection.close();
}

main().catch(console.error);
