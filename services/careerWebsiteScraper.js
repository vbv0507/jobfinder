const axios = require("axios");
const cheerio = require("cheerio");
let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch (e) {
  console.log("Puppeteer not available, fallback disabled.");
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const extractWithCheerio = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const jobs = [];

  // Common selectors for jobs on career sites
  const jobSelectors = ['article', '.job', '.position', '.job-posting', '.posting', 'li.job', 'div[data-job-id]', '.job-card'];
  
  let selectedElements = [];
  for (const selector of jobSelectors) {
    const els = $(selector);
    if (els.length > 0) {
      selectedElements = els;
      break; // Found the primary container
    }
  }

  // Fallback to all a tags if no container found
  if (selectedElements.length === 0) {
    selectedElements = $("a").filter(function() {
      const href = $(this).attr("href") || "";
      const text = $(this).text().trim().toLowerCase();
      return (href.includes("/job") || href.includes("/career") || href.includes("/position")) && text.length > 5;
    });
  }

  selectedElements.each((i, el) => {
    try {
      const elem = $(el);
      
      // Look for title
      let title = elem.find('h2, h3, h4, .title, .job-title').first().text().trim();
      if (!title) {
        title = elem.text().split('\n')[0].trim();
      }

      // Look for link
      let link = elem.attr("href") || elem.find("a").first().attr("href");
      if (!link) return; // Must have a link
      
      try {
        link = new URL(link, baseUrl).toString();
      } catch (e) {
        // Invalid URL
        return;
      }

      // Look for location
      let location = elem.find('.location, .job-location').first().text().trim();
      
      // Look for department
      let department = elem.find('.department, .category').first().text().trim();

      const jobId = link.split("/").filter(Boolean).pop();

      if (title && link) {
        jobs.push({
          title,
          location: location || "Not specified",
          jobId,
          description: [title, location, department].filter(Boolean).join(" "),
          applyLink: link,
          employmentType: "Full-Time", // Fallback
          postedAt: new Date().toISOString(), // Fallback
        });
      }
    } catch (err) {
      console.warn("Failed to parse a job element", err.message);
    }
  });

  // Deduplicate by jobId / link
  const uniqueJobs = [];
  const seenIds = new Set();
  for (const job of jobs) {
    const key = job.applyLink.toLowerCase();
    if (!seenIds.has(key)) {
      seenIds.add(key);
      uniqueJobs.push(job);
    }
  }

  return uniqueJobs;
};

const extractWithPuppeteer = async (url) => {
  if (!puppeteer) return [];
  let browser;
  try {
    // Attempt to use system edge/chrome if downloaded failed
    const executablePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    let executablePath = undefined;
    const fs = require('fs');
    for (const p of executablePaths) {
      if (fs.existsSync(p)) {
        executablePath = p;
        break;
      }
    }

    browser = await puppeteer.launch({ 
      headless: "new",
      executablePath, 
      args: ['--no-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const html = await page.content();
    return extractWithCheerio(html, url);
  } catch (err) {
    console.error(`Puppeteer extraction failed for ${url}: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
};

const scrapeCareerWebsite = async (company) => {
  console.log(`[careerWebsiteScraper] Fetching ${company.careerUrl}...`);
  try {
    const response = await axios.get(company.careerUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 15000
    });
    
    let jobs = extractWithCheerio(response.data, company.careerUrl);
    
    if (jobs.length === 0) {
      console.log(`[careerWebsiteScraper] No jobs found with Cheerio, falling back to Puppeteer...`);
      jobs = await extractWithPuppeteer(company.careerUrl);
    }
    
    return jobs;
  } catch (err) {
    console.error(`[careerWebsiteScraper] Error fetching ${company.careerUrl}: ${err.message}`);
    
    if (err.code === 'ECONNABORTED' || err.response?.status >= 400) {
      console.log(`[careerWebsiteScraper] Axios failed, falling back to Puppeteer...`);
      return await extractWithPuppeteer(company.careerUrl);
    }
    return [];
  }
};

module.exports = { scrapeCareerWebsite };
