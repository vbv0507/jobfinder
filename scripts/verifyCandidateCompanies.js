require("dotenv").config();

const AdapterFactory = require("../services/ats/AdapterFactory");

const commonConfig = {
    allowedLocations: ["india", "remote", "bengaluru", "bangalore", "gurgaon", "gurugram", "hyderabad", "pune", "noida"],
    targetKeywords: ["software engineer", "software development engineer", "sde", "backend", "frontend", "full stack", "developer", "javascript", "typescript", "node", "python", "java", "react", "ai", "machine learning"],
    excludedKeywords: ["senior", "sr ", "sr.", "staff", "principal", "manager", "director", "lead", "architect", "3+", "4+", "5+"],
};

const allCandidates = [
    { name: "Certa", category: "Product", industry: "B2B SaaS / Risk Management", ats: "ashby", careerUrl: "https://jobs.ashbyhq.com/certa", scraperConfig: { ...commonConfig, boardToken: "certa" } },
    { name: "Sarvam AI", category: "Product", industry: "Artificial Intelligence", ats: "ashby", careerUrl: "https://jobs.ashbyhq.com/sarvam", scraperConfig: { ...commonConfig, boardToken: "sarvam" } },
    { name: "Interview Kickstart", category: "Product", industry: "EdTech", ats: "ashby", careerUrl: "https://jobs.ashbyhq.com/interview-kickstart", scraperConfig: { ...commonConfig, boardToken: "interview-kickstart" } },
    { name: "Atlabs", category: "Product", industry: "Artificial Intelligence", ats: "custom", careerUrl: "https://join.atlabs.ai/", scraperConfig: commonConfig },
    { name: "QuickCom", category: "Product", industry: "Communications SaaS", ats: "custom", careerUrl: "https://quickcom.io/careers", scraperConfig: commonConfig },
    { name: "Predikt", category: "Product", industry: "FinTech / AI", ats: "custom", careerUrl: "https://predikt.in/careers/", scraperConfig: commonConfig },
    { name: "Libra AI", category: "Product", industry: "Artificial Intelligence", ats: "ashby", careerUrl: "https://jobs.ashbyhq.com/libra", scraperConfig: { ...commonConfig, boardToken: "libra" } },
];

const verifiedCompanyNames = new Set(["Certa", "Predikt"]);
const candidates = process.argv.includes("--all")
    ? allCandidates
    : allCandidates.filter((company) => verifiedCompanyNames.has(company.name));

const verifyCandidateCompanies = async () => {
    const results = [];

    for (const company of candidates) {
        const adapter = AdapterFactory.getAdapter(company);
        const startedAt = Date.now();

        try {
            const jobs = await adapter.searchJobs();
            results.push({
                company: company.name,
                adapter: adapter.parserName,
                jobsFound: jobs.length,
                durationMs: Date.now() - startedAt,
                titles: jobs.slice(0, 5).map((job) => job.title),
            });
        } catch (error) {
            results.push({
                company: company.name,
                adapter: adapter.parserName,
                jobsFound: 0,
                durationMs: Date.now() - startedAt,
                error: error.message,
            });
        }
    }

    console.log(JSON.stringify(results, null, 2));
    return results;
};

if (require.main === module) {
    verifyCandidateCompanies().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { candidates, verifyCandidateCompanies };
