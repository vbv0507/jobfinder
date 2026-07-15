const axios = require("axios");
const cheerio = require("cheerio");

const ATS_MAPPING = [
  { provider: "workday", regex: /wd\d+\.myworkdayjobs\.com/i },
  { provider: "greenhouse", regex: /boards\.greenhouse\.io/i },
  { provider: "lever", regex: /jobs\.lever\.co/i },
  { provider: "smartrecruiters", regex: /jobs\.smartrecruiters\.com/i },
  { provider: "ashby", regex: /jobs\.ashbyhq\.com/i },
  { provider: "eightfold", regex: /eightfold\.ai\/careers/i },
  { provider: "taleo", regex: /taleo\.net/i },
  { provider: "successfactors", regex: /successfactors\.com/i },
  { provider: "icims", regex: /icims\.com/i },
  { provider: "bamboohr", regex: /bamboohr\.com/i },
  { provider: "jobvite", regex: /jobvite\.com/i },
];

const constructApiUrl = (provider, url) => {
  try {
    const parsedUrl = new URL(url);
    if (provider === "greenhouse") {
      const company = parsedUrl.pathname.split("/").filter(Boolean)[0];
      return company ? `https://boards-api.greenhouse.io/v1/boards/${company}/jobs` : url;
    }
    if (provider === "lever") {
      const company = parsedUrl.pathname.split("/").filter(Boolean)[0];
      return company ? `https://api.lever.co/v0/postings/${company}` : url;
    }
    if (provider === "smartrecruiters") {
      const company = parsedUrl.pathname.split("/").filter(Boolean)[0];
      return company ? `https://api.smartrecruiters.com/v1/companies/${company}/postings` : url;
    }
    if (provider === "workday") {
      const match = parsedUrl.pathname.match(/\/([^\/]+)\/([^\/]+)/);
      if (match && parsedUrl.pathname.includes('/wday/cxs/')) {
        return url; 
      }
      const tenant = parsedUrl.hostname.split('.')[0];
      let siteId = parsedUrl.pathname.split('/').filter(Boolean).pop();
      if (!siteId || siteId === 'en-US' || siteId === 'jobs' || siteId === 'search') siteId = tenant; 
      return `https://${parsedUrl.hostname}/wday/cxs/${tenant}/${siteId}/jobs`;
    }
  } catch (err) {
    console.error(`Error constructing API URL for ${provider}: ${err.message}`);
  }
  return url;
};

const detectATS = async (careerUrl) => {
  let detectedProvider = "custom";
  let finalUrl = careerUrl;

  try {
    // 1. Check URL against known patterns
    for (const ats of ATS_MAPPING) {
      if (ats.regex.test(careerUrl)) {
        detectedProvider = ats.provider;
        finalUrl = constructApiUrl(detectedProvider, careerUrl);
        return { provider: detectedProvider, apiUrl: finalUrl };
      }
    }

    // 2. Fetch HTML for native career sites to find iframes or redirects
    const response = await axios.get(careerUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
      maxRedirects: 5,
    });
    
    for (const ats of ATS_MAPPING) {
      if (ats.regex.test(response.request.res.responseUrl)) {
        detectedProvider = ats.provider;
        finalUrl = constructApiUrl(detectedProvider, response.request.res.responseUrl);
        return { provider: detectedProvider, apiUrl: finalUrl };
      }
    }

    const html = response.data;
    const $ = cheerio.load(html);
    
    $("iframe").each((i, el) => {
      const src = $(el).attr("src");
      if (src) {
        for (const ats of ATS_MAPPING) {
          if (ats.regex.test(src)) {
            detectedProvider = ats.provider;
            finalUrl = constructApiUrl(detectedProvider, src);
            return false; 
          }
        }
      }
    });

    if (detectedProvider !== "custom") {
      return { provider: detectedProvider, apiUrl: finalUrl };
    }

    $("a").each((i, el) => {
      const href = $(el).attr("href");
      if (href) {
        for (const ats of ATS_MAPPING) {
          if (ats.regex.test(href)) {
            detectedProvider = ats.provider;
            finalUrl = constructApiUrl(detectedProvider, href);
            return false; 
          }
        }
      }
    });

  } catch (err) {
    console.warn(`[atsDetector] Warning fetching ${careerUrl}: ${err.message}`);
  }

  return { provider: detectedProvider, apiUrl: finalUrl };
};

module.exports = { detectATS, ATS_MAPPING };
