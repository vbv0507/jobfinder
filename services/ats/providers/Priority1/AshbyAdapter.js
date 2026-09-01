const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

class AshbyAdapter extends BaseAdapter {
  get parserName() { return "Ashby API"; }
  get parserVersion() { return "1.1.0"; }
  get parserRevisionDate() { return "2026-09-01"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'ashby',
        urlRegex: /api\.ashbyhq\.com\/posting-api\/job-board\/[^/]+/i,
        validatePayload: (json) => json && Array.isArray(json.jobs)
      }
    ];
  }

  async searchJobs() {
    let url = this.company.scraperConfig?.apiUrl;
    const board = this.company.scraperConfig?.boardToken || this.company.scraperConfig?.board;
    if (!url && board) {
      url = `https://api.ashbyhq.com/posting-api/job-board/${board}`;
    }
    if (!url) {
      const match = this.company.careerUrl.match(/ashbyhq\.com\/([^/?]+)/i) ||
                    this.company.careerUrl.match(/jobs\.ashbyhq\.com\/([^/?]+)/i);
      if (match && match[1]) {
        url = `https://api.ashbyhq.com/posting-api/job-board/${match[1]}`;
      } else {
        throw new Error(`Unable to build Ashby API URL for ${this.company.name}`);
      }
    }

    const { data } = await this.fetch(url);
    const jobsFromApi = data?.jobs || [];

    return jobsFromApi.map(item => {
      const secLocs = Array.isArray(item.secondaryLocations) 
        ? item.secondaryLocations.map(l => typeof l === 'string' ? l : l.location).filter(Boolean).join(", ")
        : "";
      const location = [item.location, secLocs].filter(Boolean).join(", ") || "Remote";

      return this.normalizeJob({
        title: item.title,
        location,
        jobId: item.id?.toString(),
        description: [item.department, item.employmentType, location].filter(Boolean).join(" "),
        employmentType: item.employmentType || "Full-Time",
        url: item.jobUrl || item.applyUrl,
        postedAt: normalizeDate(item.publishedAt),
        source: 'ashby'
      });
    }).filter(Boolean);
  }
}

module.exports = AshbyAdapter;
