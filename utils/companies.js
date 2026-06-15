// For now the project uses only API-based scraping.
// This keeps the code easier to understand and easier to explain in a resume.
module.exports = [
    {
    name: "Visa",
    category: "Product",
    active: true,

    careerUrl:
        "https://visa.wd5.myworkdayjobs.com/en-US/Visa",

    scraperType: "api",

    scraperConfig: {
        strategy: "workday",

        apiUrl:
            "https://visa.wd5.myworkdayjobs.com/wday/cxs/visa/Visa/jobs",

        limit: 100
    }
},
    {
        name: "LG",
        category: "Product",
        active: true,
        careerUrl: "https://globalcareers.lge.com/jobs",
        scraperType: "api",

        // LG also has an API, but its JSON shape is different from Visa.
        // The "lg" strategy tells scraperService to use the LG-specific mapper.
        scraperConfig: {
            strategy: "lg",
            apiUrl: "https://globalcareers.lge.com/api/job/v1/jobs/",
            limit: 50,
        },
    },
];
