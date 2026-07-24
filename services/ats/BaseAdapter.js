const { ScraperError, ErrorTypes } = require('../../utils/errors');
const { normalizeJobUrl } = require('../../utils/urlNormalizer');
const { executeScrapeRequest } = require('../../utils/retryChain');
const crypto = require('crypto');

class BaseAdapter {
  constructor(company) {
    this.company = company;
    this.droppedJobs = [];
    this.lastPayload = null;
  }

  get parserName() { return "Generic ATS Adapter"; }
  get parserVersion() { return "2.0.0"; }
  get parserRevisionDate() { return "2024-01-01"; }
  
  static get NetworkSignatures() {
    return []; // Return an array of signatures to match intercepted network traffic. e.g. [{ urlRegex: /foo/i }]
  }

  async searchJobs() {
    throw new Error('searchJobs() must be implemented by subclass');
  }

  async paginate() {
    // Abstract method to handle infinite scrolling or offsets
    throw new Error('paginate() must be implemented by subclass if supported');
  }

  validateJob(job) {
    if (!job.title) return "Missing title";
    if (!job.applyLink) return "Missing applyLink";
    if (!job.location) return "Location rejected";
    if (!job.source) return "Missing source";
    if (!job.description) return "Missing description";
    return null;
  }

  normalizeJob(job) {
    let rawUrl = job.url || job.applyLink || "";
    if (rawUrl && !rawUrl.startsWith('http')) {
      try { rawUrl = new URL(rawUrl, this.company.careerUrl).toString(); } catch(e) {}
    }
    const applyLink = normalizeJobUrl(rawUrl);
    const title = (job.title || "").trim();
    const description = (job.description || title).trim();
    const location = (job.location || "Not specified").trim();
    const source = job.source || this.company.ats || "unknown";
    const companyName = this.company.companyName || this.company.name; // Support legacy name
    const postedDate = job.postedDate || job.postedAt || new Date();

    const validatedJob = {
      title,
      company: companyName,
      location,
      applyLink,
      description,
      source,
      postedDate,
      postedAt: postedDate, // backward compatibility
      jobId: job.jobId || "unknown",
      experience: job.experience || "",
      employmentType: job.employmentType || "Full-Time",
    };

    const validationError = this.validateJob(validatedJob);
    if (validationError) {
      this.droppedJobs.push({
        company: companyName,
        jobTitle: job.title || "Unknown",
        reason: validationError,
        url: job.url || job.applyLink,
        ats: this.company.ats || "unknown",
        adapter: this.constructor.name,
        validationStage: 'normalizeJob'
      });
      return null;
    }

    if (validatedJob.jobId === "unknown") {
      validatedJob.jobId = crypto.createHash("md5").update(applyLink).digest("hex");
    }

    return validatedJob;
  }

  async fetch(url, config = {}) {
    try {
      const result = await executeScrapeRequest(url, config);
      this.lastPayload = result.data;
      if (result.trail) {
        if (!this.trail) this.trail = [];
        this.trail.push(...result.trail);
      }
      return result;
    } catch (e) {
      if (e.trail) {
        if (!this.trail) this.trail = [];
        this.trail.push(...e.trail);
      }
      throw e;
    }
  }
}

module.exports = BaseAdapter;
