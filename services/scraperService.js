const axios = require("axios");

// These headers make the API request look like a normal browser request.
// Some career APIs reject empty/simple server requests.
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US",
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

  if (/\b(intern|internship)\b/i.test(text)) {
    return "Internship";
  }

  if (text.includes("contract")) {
    return "Contract";
  }

  return "Full-Time";
};

const hasAllowedLocation = (job, company) => {
  const allowedLocations = company.scraperConfig?.allowedLocations || [
    "india",
    "remote",
  ];

  if (allowedLocations.length === 0) {
    return true;
  }

  const text = (job.location || "").toLowerCase();

  return allowedLocations.some((location) =>
    text.includes(location.toLowerCase()),
  );
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasExcludedKeyword = (job, excludedKeywords = []) => {
  const titleText = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  const fullText = [job.title, job.experience, job.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return excludedKeywords.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase().trim();
    const isExperienceRange = /\d+\s*(?:\+|-|to)\s*\d*/.test(normalizedKeyword);
    const text = isExperienceRange ? fullText : titleText;

    if (/^[a-z0-9]+$/.test(normalizedKeyword)) {
      return new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`).test(text);
    }

    return text.includes(normalizedKeyword);
  });
};

const hasTargetKeyword = (job, company) => {
  const targetKeywords = company.scraperConfig?.targetKeywords || [];
  const excludedKeywords = company.scraperConfig?.excludedKeywords || [];

  if (hasExcludedKeyword(job, excludedKeywords)) {
    return false;
  }

  if (targetKeywords.length === 0) {
    return true;
  }

  const text = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();

  return targetKeywords.some((keyword) => text.includes(keyword.toLowerCase()));
};

const applyJobFilters = (jobs, company) =>
  jobs.filter((job) => hasAllowedLocation(job, company) && hasTargetKeyword(job, company));

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

const getGreenhouseMetadataValue = (metadata = [], name) => {
  const item = metadata.find((entry) => entry.name === name);

  if (!item) {
    return "";
  }

  return Array.isArray(item.value) ? item.value.join(", ") : item.value;
};

const scrapeGreenhouseJobs = async (company) => {
  const config = company.scraperConfig;

  const response = await axios.get(config.apiUrl, {
    headers: DEFAULT_HEADERS,
    params: {
      content: true,
    },
    timeout: 25000,
  });

  const jobsFromApi = response.data.jobs || [];

  if (!Array.isArray(jobsFromApi)) {
    return [];
  }

  return jobsFromApi
    .map((item) => {
      const officeNames = (item.offices || []).map((office) => office.name).join(", ");
      const departmentNames = (item.departments || [])
        .map((department) => department.name)
        .join(", ");
      const postingLocation = getGreenhouseMetadataValue(
        item.metadata || [],
        "Job Posting Location",
      );

      return normalizeJob(
        {
          title: item.title,
          location: [item.location?.name, postingLocation, officeNames]
            .filter(Boolean)
            .join(", "),
          jobId: item.id,
          description: [
            item.content,
            departmentNames,
            officeNames,
            postingLocation,
          ]
            .filter(Boolean)
            .join(" "),
          applyLink: item.absolute_url,
          employmentType: item.title,
          postedAt: item.first_published || item.updated_at,
        },
        company,
      );
    })
    .filter(Boolean);
};

const scrapeLeverJobs = async (company) => {
  const config = company.scraperConfig;

  const response = await axios.get(config.apiUrl, {
    headers: DEFAULT_HEADERS,
    params: {
      mode: "json",
      ...(config.params || {}),
    },
    timeout: 25000,
  });

  const jobsFromApi = Array.isArray(response.data) ? response.data : [];

  return jobsFromApi
    .map((item) => {
      const lists = (item.lists || [])
        .map((list) => `${list.text || ""} ${list.content || ""}`)
        .join(" ");

      return normalizeJob(
        {
          title: item.text,
          location: item.categories?.location || "Not specified",
          jobId: item.id,
          description: [
            item.descriptionPlain,
            lists,
            item.categories?.team,
            item.categories?.commitment,
          ]
            .filter(Boolean)
            .join(" "),
          applyLink: item.hostedUrl || item.applyUrl,
          employmentType: item.categories?.commitment,
          postedAt: item.createdAt,
        },
        company,
      );
    })
    .filter(Boolean);
};

const scrapeWorkdayJobs = async (company) => {
    const config = company.scraperConfig;

    console.log("Workday URL:", config.apiUrl);

    try {
        const response = await axios.post(
            config.apiUrl,
            {
                appliedFacets: {},
                limit: Math.min(config.limit || 20, 20),
                offset: 0,
            },
            {
                headers: {
                    ...DEFAULT_HEADERS,
                    "Content-Type": "application/json",
                },
                timeout: 25000,
            }
        );

        console.log("Workday Success");

        const jobsFromApi =
            response.data.jobPostings ||
            response.data.jobPostingsData ||
            [];

        console.log("Jobs Found:", jobsFromApi.length);

        return jobsFromApi
            .map((item) =>
                normalizeJob(
                    {
                        title: item.title,
                        location:
                            item.locationsText ||
                            item.location ||
                            "Not specified",

                        jobId:
                            item.bulletFields?.[0] ||
                            item.externalPath ||
                            item.id,

                        description: item.title,

                        applyLink:
                            `${company.careerUrl}/job${item.externalPath}`,

                        postedAt: item.postedOn,

                        employmentType: "Full-Time",
                    },
                    company
                )
            )
            .filter(Boolean);

    } catch (error) {

        console.log(
            "Workday Error:",
            error.response?.status
        );

        console.log(
            "Workday Response:",
            error.response?.data
        );

        return [];
    }
};
const scrapeCompanyJobs = async (company) => {
  try {
    let jobs;

    if (company.scraperConfig?.strategy === "lg") {
      jobs = await scrapeLgJobs(company);
      return applyJobFilters(jobs, company);
    }

    if (company.scraperConfig?.strategy === "greenhouse") {
      jobs = await scrapeGreenhouseJobs(company);
      return applyJobFilters(jobs, company);
    }

    if (company.scraperConfig?.strategy === "lever") {
      jobs = await scrapeLeverJobs(company);
      return applyJobFilters(jobs, company);
    }

    if (company.scraperConfig?.strategy === "workday") {
      jobs = await scrapeWorkdayJobs(company);
      return applyJobFilters(jobs, company);
    }

    jobs = await scrapeGenericApiJobs(company);
    return applyJobFilters(jobs, company);
  } catch (error) {
    console.log(`Scraping failed for ${company.name}: ${error.message}`);
    return [];
  }
};
module.exports = {
  scrapeCompanyJobs,
};
