require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const runSearch = require('../cron/jobSearchCron');
const fs = require('fs');
const path = require('path');

const TARGET_COMPANIES = ['Adobe', 'NVIDIA', 'Visa', 'Anthropic', 'Scale AI', 'American Express', 'Mastercard', 'PayPal'];

async function verify() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    const allCompanies = await Company.find({});
    const backupStates = allCompanies.map(c => ({ id: c._id, active: c.active }));

    try {
        await Company.updateMany({}, { active: false });
        await Company.updateMany({ name: { $in: TARGET_COMPANIES } }, { active: true, lastScrapedAt: null });
        
        console.log(`Running verification pipeline on: ${TARGET_COMPANIES.join(', ')}...\n`);
        
        const PipelineLock = require('../models/PipelineLock');
        await PipelineLock.deleteMany({});
        
        await runSearch("Verification_Phase10", true);
        
        console.log("\n--- VERIFICATION REPORT ---");
        const evidencePath = path.join(__dirname, '..', 'evidence.json');
        if (fs.existsSync(evidencePath)) {
            const data = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
            
            console.log(
                "Company".padEnd(20) + 
                "| Parsed | Duplicates | Loc Fail | Key Fail | Exp Fail | Emp Fail | Dom Fail | AI Rej | Matched | Saved"
            );
            console.log("-".repeat(110));
            
            for (const c of data) {
                const f = c.funnel;
                if (!f) continue;
                console.log(
                    c.company.padEnd(20) + "| " +
                    String(f.parsed || 0).padEnd(7) + "| " +
                    String(f.duplicate || 0).padEnd(11) + "| " +
                    String(f.location || 0).padEnd(9) + "| " +
                    String(f.keyword || 0).padEnd(9) + "| " +
                    String(f.experience || 0).padEnd(9) + "| " +
                    String(f.employment || 0).padEnd(9) + "| " +
                    String(f.domain || 0).padEnd(9) + "| " +
                    String(f.aiRejected || 0).padEnd(7) + "| " +
                    String(f.matched || 0).padEnd(8) + "| " +
                    String(f.saved || 0)
                );
            }
        }
        
    } finally {
        console.log("\nRestoring company active states...");
        for (const state of backupStates) {
            await Company.updateOne({ _id: state.id }, { active: state.active });
        }
        await mongoose.disconnect();
        console.log("Done.");
    }
}

verify().catch(console.error);
