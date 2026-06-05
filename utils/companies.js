// For now the project uses only API-based scraping.
// This keeps the code easier to understand and easier to explain in a resume.
module.exports = [
    {
        name: "Visa",
        category: "Product",
        active: true,
        careerUrl: "https://careers.smartrecruiters.com/Visa",
        scraperType: "api",

        // Visa uses SmartRecruiters.
        // SmartRecruiters gives a clean JSON API, so it is the easiest example.
        scraperConfig: {
            apiUrl: "https://api.smartrecruiters.com/v1/companies/Visa/postings",
            applyUrlBase: "https://jobs.smartrecruiters.com/Visa",
            listPath: "content",
            fields: {
                title: "name",
                jobId: "id",
                location: "location.fullLocation",
                employmentType: "typeOfEmployment.label",
                experience: "experienceLevel.label",
                postedAt: "releasedDate",
                applyLink: "ref",
                department: "department.label",
                function: "function.label",
            },
        },
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
