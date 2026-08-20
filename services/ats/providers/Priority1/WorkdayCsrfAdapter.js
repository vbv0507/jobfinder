const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * WorkdayCsrfAdapter — Handles Workday endpoints that require session cookies
 * (returns 422 Unprocessable Entity otherwise). Workday caps limit at 20 per page.
 *
 * Step 1: GET the career site page to obtain session cookies + optional CSRF token.
 * Step 2: POST to /wday/cxs/{tenant}/{board}/jobs with those cookies.
 */
class WorkdayCsrfAdapter extends BaseAdapter {
  get parserName() { return 'Workday CSRF API'; }
  get parserVersion() { return '1.1.0'; }
  get parserRevisionDate() { return '2026-08-20'; }

  async searchJobs() {
    const config  = this.company.scraperConfig || {};
    const apiUrl  = config.apiUrl;
    const siteUrl = config.siteUrl;

    if (!apiUrl || !siteUrl) {
      const { ScraperError } = require('../../../../utils/errors');
      throw new ScraperError('INVALID_ENDPOINT', 'WorkdayCsrfAdapter requires apiUrl and siteUrl');
    }

    const axios = require('axios');

    // ── Step 1: GET career site page to obtain session cookies ──────────────
    let cookies = '';
    let csrfToken = '';

    try {
      const pageRes = await axios.get(siteUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      const rawCookies = pageRes.headers['set-cookie'];
      if (Array.isArray(rawCookies)) {
        cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
      }

      // Extract CSRF token if Workday embeds it in the HTML
      const html = typeof pageRes.data === 'string' ? pageRes.data : '';
      const csrfPatterns = [
        /csrfToken["']?\s*:\s*["']([^"']+)["']/i,
        /X-CALYPSO-CSRF-TOKEN["']?\s*:\s*["']([^"']+)["']/i,
        /calypso-csrf-token["']?\s*content=["']([^"']+)["']/i,
        /"token"\s*:\s*"([a-f0-9-]{36})"/i,
      ];
      for (const pat of csrfPatterns) {
        const m = html.match(pat);
        if (m) { csrfToken = m[1]; break; }
      }
    } catch (e) {
      console.log(`[WorkdayCsrfAdapter][${this.company.name}] Page GET failed: ${e.message} — proceeding without cookies`);
    }

    // ── Step 2: POST paginated jobs API ────────────────────────────────────
    // Workday hard-caps limit at 20; higher values → HTTP 400
    const LIMIT = 20;
    let offset = 0;
    let allJobs = [];

    let applyBaseUrl = this.company.careerUrl || '';
    const urlMatch = apiUrl.match(/https:\/\/(.+?)\/wday\/cxs\/[^/]+\/([^/]+)/);
    if (urlMatch) {
      applyBaseUrl = `https://${urlMatch[1]}/en-US/${urlMatch[2]}`;
    }

    const postHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': siteUrl.replace(/\/[^/]+$/, ''),
      'Referer': siteUrl,
      ...(cookies ? { 'Cookie': cookies } : {}),
      ...(csrfToken ? { 'X-CALYPSO-CSRF-TOKEN': csrfToken } : {}),
    };

    while (offset < 200) {
      const payload = { appliedFacets: {}, limit: LIMIT, offset, searchText: '' };

      try {
        const res = await axios.post(apiUrl, payload, { headers: postHeaders, timeout: 15000 });
        const jobs = res.data?.jobPostings || res.data?.jobPostingsData || [];

        if (!jobs.length) break;
        allJobs = allJobs.concat(jobs);
        offset += LIMIT;
        if (jobs.length < LIMIT) break;
      } catch (err) {
        if (offset === 0) throw err;
        console.log(`[WorkdayCsrfAdapter][${this.company.name}] Pagination stopped at offset ${offset}: ${err.message}`);
        break;
      }
    }

    return allJobs.map(item => {
      const jobId = item.externalPath || item.bulletFields?.[0] || item.id;
      const jobUrl = item.externalPath
        ? `${applyBaseUrl}${item.externalPath}`
        : (jobId ? `${applyBaseUrl}/job/${jobId}` : '');

      return this.normalizeJob({
        title      : item.title,
        location   : item.locationsText || item.location || '',
        jobId,
        description: item.title,
        url        : jobUrl,
        postedAt   : normalizeDate(item.postedOn),
        source     : 'workday',
      });
    }).filter(Boolean);
  }
}

module.exports = WorkdayCsrfAdapter;
