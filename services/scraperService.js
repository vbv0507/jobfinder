const axios = require("axios");

// These headers make the API request look like a normal browser request.
// Some career APIs reject empty/simple server requests.
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

// Every company returns jobs in a different JSON structure.
// This helper safely reads nested values like "location.fullLocation".
const getValue = (object, path) => {
  if (!path) {
    return "";
  }

  return path.split(".").reduce((current, key) => {
    if (!current) {
      return "";
    }

    return current[key];
  }, object);
};

// Job descriptions may contain HTML tags from company APIs.
// We clean them before saving so MongoDB and Gemini receive readable text.
const cleanText = (value = "") =>
  value
    .toString()
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// If a job gives a relative URL, convert it to a full URL.
// This keeps every applyLink usable directly from the dashboard.
const makeFullUrl = (url, baseUrl) => {
  if (!url) {
    return baseUrl;
  }

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
};

// Some APIs give only a job id, not a public apply page.
// This builds a browser-friendly URL when the company config provides a base.
const makeApplyLink = (item, config) => {
  if (config.applyUrlBase && config.fields?.jobId) {
    return `${config.applyUrlBase}/${getValue(item, config.fields.jobId)}`;
  }

  return getValue(item, config.fields.applyLink);
};

const parseDate = (value) => {
  if (!value) {
    return undefined;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
};

const getEmploymentType = (value = "") => {
  const text = value.toLowerCase();

  if (text.includes("intern")) {
    return "Internship";
  }

  if (text.includes("contract")) {
    return "Contract";
  }

  return "Full-Time";
};

// This is the common job shape used by the rest of the project.
// RawJob, Gemini analysis, and MatchedJob all depend on this structure.
const normalizeJob = (job, company) => {
  const title = cleanText(job.title);
  const applyLink = makeFullUrl(job.applyLink, company.careerUrl);

  if (!title || !applyLink) {
    return null;
  }

  return {
    title,
    location: cleanText(job.location || "Not specified"),
    jobId: cleanText(job.jobId || applyLink.split("/").filter(Boolean).pop()),
    experience: cleanText(job.experience),
    description: cleanText(job.description || title),
    applyLink,
    employmentType: getEmploymentType(job.employmentType || title),
    postedAt: parseDate(job.postedAt),
  };
};

// Generic API scraper.
// Use this when the company API already returns a simple job list.
// Visa uses this because SmartRecruiters has predictable JSON fields.
const scrapeGenericApiJobs = async (company) => {
  const config = company.scraperConfig;

  const response = await axios.get(config.apiUrl, {
    headers: DEFAULT_HEADERS,
    params: config.params || {},
    timeout: 25000,
  });

  const jobsFromApi = getValue(response.data, config.listPath);

  if (!Array.isArray(jobsFromApi)) {
    return [];
  }

  return jobsFromApi
    .map((item) => {
      const fields = config.fields;

      return normalizeJob(
        {
          title: getValue(item, fields.title),
          location: getValue(item, fields.location),
          jobId: getValue(item, fields.jobId),
          experience: getValue(item, fields.experience),
          description: [
            getValue(item, fields.department),
            getValue(item, fields.function),
            getValue(item, fields.location),
          ]
            .filter(Boolean)
            .join(" "),
          applyLink: makeApplyLink(item, config),
          employmentType: getValue(item, fields.employmentType),
          postedAt: getValue(item, fields.postedAt),
        },
        company,
      );
    })
    .filter(Boolean);
};

// LG has its own API response format.
// This separate function keeps the generic scraper simple and easy to explain.
const scrapeLgJobs = async (company) => {
  const config = company.scraperConfig;

  const response = await axios.get(config.apiUrl, {
    headers: DEFAULT_HEADERS,
    params: {
      page: 1,
      size: config.limit || 50,
      langCd: "en",
    },
    timeout: 25000,
  });

  const jobsFromApi = response.data.data?.list || [];

  if (!Array.isArray(jobsFromApi)) {
    return [];
  }

  return jobsFromApi
    .map((item) =>
      normalizeJob(
        {
          title: item.title,
          location: [item.location, item.cntryNm].filter(Boolean).join(", "),
          jobId: item.id,
          description: `${item.content || ""} ${item.jobFamily || ""}`,
          applyLink: `https://globalcareers.lge.com/jobs/${item.id}`,
          employmentType: item.empType || item.workType,
          postedAt: item.postCreateDtm || item.postUpdateDtm,
        },
        company,
      ),
    )
    .filter(Boolean);
};
const scrapeWorkdayJobs = async (company) => {
  const config = company.scraperConfig;

  const response = await axios.post(
    config.apiUrl,
    {
      limit: config.limit || 100,
      offset: 0,
    },
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    },
  );

  const jobsFromApi =
    response.data.jobPostings || response.data.jobPostingsData || [];

  if (!Array.isArray(jobsFromApi)) {
    return [];
  }

  return jobsFromApi
    .map((item) =>
      normalizeJob(
        {
          title: item.title,

          location: item.locationsText || item.location || "Not specified",

          jobId: item.bulletFields?.[0] || item.externalPath || item.id,
          description: item.title,

          applyLink: `https://visa.wd5.myworkdayjobs.com/en-US/Visa/job${item.externalPath}`,

          postedAt: item.postedOn,

          employmentType: "Full-Time",
        },
        company,
      ),
    )
    .filter(Boolean);
};
const scrapeCompanyJobs = async (company) => {
  try {
    if (company.scraperConfig?.strategy === "lg") {
      return await scrapeLgJobs(company);
    }

    if (company.scraperConfig?.strategy === "workday") {
      return await scrapeWorkdayJobs(company);
    }

    return await scrapeGenericApiJobs(company);
  } catch (error) {
    console.log(`Scraping failed for ${company.name}: ${error.message}`);
    return [];
  }
};
module.exports = {
  scrapeCompanyJobs,
};
