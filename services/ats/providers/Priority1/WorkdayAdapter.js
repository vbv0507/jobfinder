const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');
const axios = require('axios');

class WorkdayAdapter extends BaseAdapter {
  get parserName() { return "Workday GraphQL/API"; }
  get parserVersion() { return "2.2.0"; }
  get parserRevisionDate() { return "2026-09-01"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'workday',
        urlRegex: /\/wday\/cxs\/[^/]+\/[^/]+\/jobs/i,
        validatePayload: (json) => json && Array.isArray(json.jobPostings)
      }
    ];
  }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    let careerUrl = this.company.careerUrl || '';
    let apiUrl = config.apiUrl;
    let siteUrl = config.siteUrl || careerUrl;

    // Auto-derive Workday apiUrl from careerUrl if missing
    if (!apiUrl) {
      const match = careerUrl.match(/https:\/\/([^/]+)\.myworkdayjobs\.com\/([^/?#]+)/i);
      if (match) {
        const host = `${match[1]}.myworkdayjobs.com`;
        const tenant = match[1].split('.')[0];
        const board = match[2].replace(/^en-US\//i, '');
        apiUrl = `https://${host}/wday/cxs/${tenant}/${board}/jobs`;
      }
    }

    if (!apiUrl) {
      const { ScraperError } = require('../../../../utils/errors');
      throw new ScraperError('INVALID_ENDPOINT', `Unable to build Workday API URL for ${this.company.name}`);
    }

    // Step 1: Pre-flight session cookies for zero 422 errors
    let cookies = '';
    let csrfToken = '';
    try {
      const pageRes = await axios.get(siteUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      const rawCookies = pageRes.headers['set-cookie'];
      if (Array.isArray(rawCookies)) {
        cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
      }
    } catch (_) {}

    // Compute base URL for apply links
    let applyBaseUrl = careerUrl;
    const urlMatch = apiUrl.match(/https:\/\/(.+?)\/wday\/cxs\/[^/]+\/([^/]+)/);
    if (urlMatch) {
      applyBaseUrl = `https://${urlMatch[1]}/en-US/${urlMatch[2]}`;
    }

    const postHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(cookies ? { 'Cookie': cookies } : {}),
    };

    const LIMIT = 20;
    let offset = 0;
    let allJobs = [];

    while (offset < 200) {
      const payload = { appliedFacets: {}, limit: LIMIT, offset, searchText: '' };

      try {
        const res = await axios.post(apiUrl, payload, { headers: postHeaders, timeout: 15000 });
        const jobsFromApi = res.data?.jobPostings || res.data?.jobPostingsData || [];
        if (!jobsFromApi.length) break;

        allJobs = allJobs.concat(jobsFromApi);
        offset += LIMIT;
        if (jobsFromApi.length < LIMIT) break;
      } catch (err) {
        if (offset === 0) throw err;
        break;
      }
    }

    return allJobs.map(item => {
      const jobId = item.externalPath || item.bulletFields?.[0] || item.id;
      const jobUrl = item.externalPath 
        ? `${applyBaseUrl}${item.externalPath}` 
        : (jobId ? `${applyBaseUrl}/job/${jobId}` : (this.company.careerUrl || apiUrl));

      return this.normalizeJob({
        title: item.title,
        location: item.locationsText || item.location || 'Remote / Global',
        jobId: jobId || `${this.company.name.toLowerCase()}-${Buffer.from(item.title || '').toString('hex').slice(0, 10)}`,
        description: item.title,
        url: jobUrl,
        postedAt: normalizeDate(item.postedOn),
        source: 'workday'
      });
    }).filter(Boolean);
  }
}

module.exports = WorkdayAdapter;
