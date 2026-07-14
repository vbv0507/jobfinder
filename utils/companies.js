

module.exports = [
    {
        name: "CommerceIQ",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/commerceiq",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/commerceiq/jobs",
            limit: 100,
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "remote",
            ],
            targetKeywords: [
                "software development engineer",
                "software engineer",
                "backend",
                "server side",
                "api",
                "java",
                "python",
                "spring boot",
                "dsa",
            ],
            excludedKeywords: [
                "engineer ii",
                "engineer iii",
                "senior",
                "staff",
                "principal",
                "manager",
                "director",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
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

        limit: 20,
        allowedLocations: [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
        ],
        targetKeywords: [
            "software engineer",
            "software development engineer",
            "sde",
            "backend",
            "developer",
            "api",
        ],
        excludedKeywords: [
            "senior",
            "sr ",
            "sr.",
            "staff",
            "principal",
            "manager",
            "director",
            "lead",
            "1-3",
            "1 to 3",
            "2+",
            "3+",
        ],
    }
},
    {
        name: "LG",
        category: "Product",
        active: true,
        careerUrl: "https://globalcareers.lge.com/jobs",
        scraperType: "api",

        
        
        scraperConfig: {
            strategy: "lg",
            apiUrl: "https://globalcareers.lge.com/api/job/v1/jobs/",
            limit: 50,
            allowedLocations: [
                "india",
                "remote",
                "bengaluru",
                "bangalore",
                "noida",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "backend",
                "developer",
                "api",
                "node",
                "java",
                "python",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "embedded",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Adobe",
        category: "Product",
        active: true,
        careerUrl: "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs",
            limit: 20,
            allowedLocations: [
                "india",
                "remote",
                "bengaluru",
                "bangalore",
                "noida",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Paytm",
        category: "Product",
        active: true,
        careerUrl: "https://jobs.lever.co/paytm",
        scraperType: "api",
        scraperConfig: {
            strategy: "lever",
            apiUrl: "https://api.lever.co/v0/postings/paytm",
            allowedLocations: [
                "india",
                "remote",
                "bengaluru",
                "bangalore",
                "noida",
                "hyderabad",
                "pune",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "node",
                "java",
                "python",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "PhonePe",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/phonepe",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/phonepe/jobs",
            allowedLocations: [
                "india",
                "remote",
                "bengaluru",
                "bangalore",
                "pune",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "java",
                "python",
            ],
            excludedKeywords: [
                "engineering manager",
                "senior",
                "sr ",
                "sr.",
                "android",
                "ios",
                "mobile",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "head",
                "architect",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Groww",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/groww",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/groww/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "node",
                "java",
                "python",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "content",
                "marketing",
                "growth",
                "design",
                "designer",
                "graphic",
                "video",
                "editor",
                "copy writer",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "InMobi",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/inmobi",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/inmobi/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "product manager",
                "salesforce",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Tekion",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/tekion",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/tekion/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "frontend",
                "android",
                "ios",
                "mobile",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Thoughtworks",
        category: "Service",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/thoughtworks",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/thoughtworks/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "pune",
                "chennai",
                "hyderabad",
                "gurgaon",
                "noida",
            ],
            targetKeywords: [
                "graduate developer",
                "associate developer",
                "software developer",
                "developer",
                "software engineer",
                "backend",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "consultant",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Nagarro",
        category: "Service",
        active: true,
        careerUrl: "https://jobs.smartrecruiters.com/Nagarro1",
        scraperType: "api",
        scraperConfig: {
            strategy: "smartrecruiters",
            apiUrl: "https://api.smartrecruiters.com/v1/companies/Nagarro1/postings",
            limit: 100,
            params: {
                search: "software",
            },
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "pune",
                "gurgaon",
                "noida",
                "hyderabad",
            ],
            targetKeywords: [
                "software engineer",
                "software developer",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "associate principal",
                "manager",
                "director",
                "lead",
                "architect",
                "frontend",
                "data science",
                "machine learning",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Razorpay",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "mumbai",
                "hyderabad",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "sales",
                "operations",
                "banking",
                "growth",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "MongoDB",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/mongodb",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "gurugram",
                "hyderabad",
                "pune",
            ],
            targetKeywords: [
                "software engineer",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "sales",
                "account",
                "recruiter",
                "support",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "GitLab",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/gitlab",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs",
            allowedLocations: [
                "india",
                "remote, india",
                "remote - india",
            ],
            targetKeywords: [
                "backend engineer",
                "software engineer",
                "developer",
                "api",
                "golang",
                "ruby",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "customer success",
                "solutions",
                "sales",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Postman",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/postman",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/postman/jobs",
            allowedLocations: [
                "india",
                "bengaluru",
                "bangalore",
                "remote, india",
                "remote - india",
            ],
            targetKeywords: [
                "backend",
                "system engineer",
                "software engineer",
                "developer",
                "api",
                "node",
                "golang",
                "java",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "frontend",
                "frontend-heavy",
                "fullstack",
                "solutions engineer",
                "customer success",
                "sales",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Databricks",
        category: "Product",
        active: true,
        careerUrl: "https://job-boards.greenhouse.io/databricks",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs",
            allowedLocations: [
                "india",
                "remote - india",
                "remote, india",
                "bengaluru",
                "bangalore",
            ],
            targetKeywords: [
                "software engineer",
                "backend",
                "developer",
                "api",
                "python",
                "java",
                "scala",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "forward deployed",
                "solutions",
                "sales",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Zeta",
        category: "Product",
        active: true,
        careerUrl: "https://jobs.lever.co/zeta",
        scraperType: "api",
        scraperConfig: {
            strategy: "lever",
            apiUrl: "https://api.lever.co/v0/postings/zeta",
            allowedLocations: [
                "india",
                "bangalore",
                "bengaluru",
                "mumbai",
                "hyderabad",
            ],
            targetKeywords: [
                "software engineer",
                "software developer",
                "backend",
                "developer",
                "api",
                "java",
                "python",
                "node",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "operations",
                "payroll",
                "compliance",
                "sales",
                "1-3",
                "1 to 3",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Telegram Jobs",
        category: "Product",
        active: true,
        careerUrl: "https://t.me/LMTJobUpdates",
        scraperType: "api",
        scraperConfig: {
            strategy: "telegram",
            allowedLocations: [
                "india",
                "remote",
                "bengaluru",
                "bangalore",
                "noida",
                "hyderabad",
                "pune",
            ],
            targetKeywords: [
                "software engineer",
                "software development engineer",
                "sde",
                "backend",
                "developer",
                "api",
                "node",
                "java",
                "python",
                "intern",
                "internship",
                "fresher",
            ],
            excludedKeywords: [
                "senior",
                "sr ",
                "sr.",
                "staff",
                "principal",
                "manager",
                "director",
                "lead",
                "architect",
                "2+",
                "3+",
            ],
        },
    },
    {
        name: "Microsoft",
        category: "Product",
        active: true,
        careerUrl: "https://careers.microsoft.com",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://microsoft.wd1.myworkdayjobs.com/wday/cxs/microsoft/Microsoft/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "hyderabad", "noida", "bangalore"],
            targetKeywords: ["software engineer", "sde", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Stripe",
        category: "Product",
        active: true,
        careerUrl: "https://stripe.com/jobs",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://stripe.wd5.myworkdayjobs.com/wday/cxs/stripe/Stripe/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Atlassian",
        category: "Product",
        active: true,
        careerUrl: "https://www.atlassian.com/company/careers",
        scraperType: "api",
        scraperConfig: {
            strategy: "lever",
            apiUrl: "https://api.lever.co/v0/postings/atlassian",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Cloudflare",
        category: "Product",
        active: true,
        careerUrl: "https://www.cloudflare.com/careers/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Datadog",
        category: "Product",
        active: true,
        careerUrl: "https://careers.datadoghq.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "noida", "hyderabad", "pune"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Dropbox",
        category: "Product",
        active: true,
        careerUrl: "https://jobs.dropbox.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Snowflake",
        category: "Product",
        active: true,
        careerUrl: "https://careers.snowflake.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/snowflake/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "pune"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "NVIDIA",
        category: "Product",
        active: true,
        careerUrl: "https://www.nvidia.com/en-us/about/careers/",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "pune", "hyderabad"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Cisco",
        category: "Product",
        active: true,
        careerUrl: "https://jobs.cisco.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "smartrecruiters",
            apiUrl: "https://api.smartrecruiters.com/v1/companies/Cisco/postings",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "pune", "chennai"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Intel",
        category: "Product",
        active: true,
        careerUrl: "https://jobs.intel.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External_Site/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "AMD",
        category: "Product",
        active: true,
        careerUrl: "https://careers.amd.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://amd.wd5.myworkdayjobs.com/wday/cxs/amd/External/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "hyderabad"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Twilio",
        category: "Product",
        active: true,
        careerUrl: "https://www.twilio.com/company/jobs",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "ServiceNow",
        category: "Product",
        active: true,
        careerUrl: "https://careers.servicenow.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "smartrecruiters",
            apiUrl: "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings",
            allowedLocations: ["india", "remote", "hyderabad", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Elastic",
        category: "Product",
        active: true,
        careerUrl: "https://www.elastic.co/about/careers",
        scraperType: "api",
        scraperConfig: {
            strategy: "lever",
            apiUrl: "https://api.lever.co/v0/postings/elastic",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "HashiCorp",
        category: "Product",
        active: true,
        careerUrl: "https://www.hashicorp.com/jobs",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/hashicorp/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Confluent",
        category: "Product",
        active: true,
        careerUrl: "https://www.confluent.io/careers/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/confluent/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Okta",
        category: "Product",
        active: true,
        careerUrl: "https://www.okta.com/company/careers/",
        scraperType: "api",
        scraperConfig: {
            strategy: "greenhouse",
            apiUrl: "https://boards-api.greenhouse.io/v1/boards/okta/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    },
    {
        name: "Salesforce",
        category: "Product",
        active: true,
        careerUrl: "https://careers.salesforce.com/",
        scraperType: "api",
        scraperConfig: {
            strategy: "workday",
            apiUrl: "https://salesforce.wd1.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs",
            allowedLocations: ["india", "remote", "bengaluru", "bangalore", "hyderabad"],
            targetKeywords: ["software engineer", "backend", "developer", "api"],
            excludedKeywords: ["senior", "principal", "manager", "director", "lead", "2+", "3+"]
        }
    }
    ,{
    "name": "Airbnb",
    "category": "Product",
    "active": true,
    "careerUrl": "https://careers.airbnb.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "greenhouse",
        "apiUrl": "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Meesho",
    "category": "Product",
    "active": true,
    "careerUrl": "https://job-boards.greenhouse.io/meesho",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "greenhouse",
        "apiUrl": "https://boards-api.greenhouse.io/v1/boards/meesho/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api",
            "sde"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Dream11",
    "category": "Product",
    "active": true,
    "careerUrl": "https://job-boards.greenhouse.io/dream11",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "greenhouse",
        "apiUrl": "https://boards-api.greenhouse.io/v1/boards/dream11/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "mumbai",
            "pune",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "BrowserStack",
    "category": "Product",
    "active": true,
    "careerUrl": "https://job-boards.greenhouse.io/browserstack",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "greenhouse",
        "apiUrl": "https://boards-api.greenhouse.io/v1/boards/browserstack/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "mumbai",
            "noida",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Freshworks",
    "category": "Product",
    "active": true,
    "careerUrl": "https://job-boards.greenhouse.io/freshworks",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "greenhouse",
        "apiUrl": "https://boards-api.greenhouse.io/v1/boards/freshworks/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "chennai",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "CRED",
    "category": "Product",
    "active": true,
    "careerUrl": "https://jobs.lever.co/cred",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "lever",
        "apiUrl": "https://api.lever.co/v0/postings/cred",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api",
            "sde"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Swiggy",
    "category": "Product",
    "active": true,
    "careerUrl": "https://jobs.lever.co/swiggy",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "lever",
        "apiUrl": "https://api.lever.co/v0/postings/swiggy",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "hyderabad",
            "gurgaon"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api",
            "sde"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Zomato",
    "category": "Product",
    "active": true,
    "careerUrl": "https://jobs.lever.co/zomato",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "lever",
        "apiUrl": "https://api.lever.co/v0/postings/zomato",
        "allowedLocations": [
            "india",
            "remote",
            "gurgaon",
            "noida",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api",
            "sde"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "VMware",
    "category": "Product",
    "active": true,
    "careerUrl": "https://careers.vmware.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://vmware.wd1.myworkdayjobs.com/wday/cxs/vmware/VMware/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "pune"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "PayPal",
    "category": "Product",
    "active": true,
    "careerUrl": "https://careers.paypal.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://paypal.wd1.myworkdayjobs.com/wday/cxs/paypal/jobs/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "chennai"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Mastercard",
    "category": "Product",
    "active": true,
    "careerUrl": "https://careers.mastercard.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://mastercard.wd1.myworkdayjobs.com/wday/cxs/mastercard/CorporateCareers/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "pune",
            "gurgaon"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Qualcomm",
    "category": "Semiconductor",
    "active": true,
    "careerUrl": "https://careers.qualcomm.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://qualcomm.wd5.myworkdayjobs.com/wday/cxs/qualcomm/External/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "hyderabad",
            "chennai"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Broadcom",
    "category": "Semiconductor",
    "active": true,
    "careerUrl": "https://careers.broadcom.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://broadcom.wd1.myworkdayjobs.com/wday/cxs/broadcom/External_Career_Site/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "hyderabad",
            "pune"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Cadence",
    "category": "Semiconductor",
    "active": true,
    "careerUrl": "https://careers.cadence.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://cadence.wd1.myworkdayjobs.com/wday/cxs/cadence/External_Careers/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "noida",
            "bengaluru",
            "bangalore",
            "pune"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Micron",
    "category": "Semiconductor",
    "active": true,
    "careerUrl": "https://careers.micron.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://micron.wd1.myworkdayjobs.com/wday/cxs/micron/External/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "hyderabad",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "PwC India",
    "category": "Service",
    "active": true,
    "careerUrl": "https://jobs.pwc.com/",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "workday",
        "apiUrl": "https://pwc.wd3.myworkdayjobs.com/wday/cxs/pwc/Global_Experienced_Careers/jobs",
        "allowedLocations": [
            "india",
            "remote",
            "bengaluru",
            "bangalore",
            "hyderabad",
            "gurgaon"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
},
    {
    "name": "Western Digital",
    "category": "Semiconductor",
    "active": true,
    "careerUrl": "https://jobs.smartrecruiters.com/WesternDigital",
    "scraperType": "api",
    "scraperConfig": {
        "strategy": "smartrecruiters",
        "apiUrl": "https://api.smartrecruiters.com/v1/companies/WesternDigital/postings",
        "allowedLocations": [
            "india",
            "bengaluru",
            "bangalore"
        ],
        "targetKeywords": [
            "software engineer",
            "backend",
            "developer",
            "api"
        ],
        "excludedKeywords": [
            "senior",
            "principal",
            "manager",
            "director",
            "lead",
            "2+",
            "3+"
        ]
    }
}
];
