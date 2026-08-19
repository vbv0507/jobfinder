const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * WorkdayCsrfAdapter — Handles Workday endpoints that require session cookies
 * and CSRF tokens (returns 422 Unprocessable Entity otherwise).
 * 
 * First performs a GET to the career site page, extracts the session cookies
 * and X-CALYPSO-CSRF-TOKEN, then POSTs to the /wday/cxs/.../jobs endpoint.
 */
class WorkdayCsrfAdapter extends BaseAdapter {
  get parserName() { return "Workday CSRF API"; }
  get parserVersion() { return "1.0.0"; }
  get parserRevisionDate() { return "2026-08-19"; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const apiUrl = config.apiUrl;
    const siteUrl = config.siteUrl; // The URL to GET first for cookies
    const dataPayload = config.apiPayload || { appliedFacets: {}, limit: 50, offset: 0, searchText: 'software engineer' };

    if (!apiUrl || !siteUrl) {
      const { ScraperError } = require('../../../../utils/errors');
      throw new ScraperError('INVALID_ENDPOINT', 'WorkdayCsrfAdapter requires both apiUrl and siteUrl in scraperConfig');
    }

    const axios = require('axios');
    
    // Step 1: GET the page to get session cookies
    let cookies = '';
    let csrfToken = '';
    
    try {
      const pageRes = await axios.get(siteUrl, {
        timeout: 15000,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
        }
      });
      
      const rawCookies = pageRes.headers && pageRes.headers['set-cookie'];
      if (rawCookies && Array.isArray(rawCookies)) {
        cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
      }

      const html = typeof pageRes.data === 'string' ? pageRes.data : '';
      const patterns = [
        /csrfToken["']?\s*:\s*["']([^"']+)["']/i,
        /X-CALYPSO-CSRF-TOKEN["']?\s*:\s*["']([^"']+)["']/i,
        /"token"\s*:\s*"([a-f0-9-]{36})"/i,
        /calypso-csrf-token["']?\s*content=["']([^"']+)["']/i,
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m) { csrfToken = m[1]; break; }
      }
    } catch (e) {
      console.log(`[WorkdayCsrfAdapter] Failed to GET initial page for ${this.company.name}: ${e.message}`);
    }

    const limit = dataPayload.limit || 20;
    let offset = dataPayload.offset || 0;
    let allJobs = [];
    let hasMore = true;

    let applyBaseUrl = this.company.careerUrl;
    const match = apiUrl.match(/https:\/\/(.+?)\/wday\/cxs\/[^\/]+\/([^\/]+)/);
    if (match) {
      applyBaseUrl = `https://${match[1]}/en-US/${match[2]}`;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Referer': siteUrl,
      ...(cookies ? { 'Cookie': cookies } : {}),
      ...(csrfToken ? { 'X-CALYPSO-CSRF-TOKEN': csrfToken } : {})
    };

    console.log('WD headers:', headers);
    console.log('WD payload:', dataPayload);

    while (hasMore && offset < 200) {
      try {
        dataPayload.limit = limit;
        dataPayload.offset = offset;

        const res = await axios.post(apiUrl, dataPayload, { headers, timeout: 15000 });
        const data = res.data;

        const jobsFromApi = data.jobPostings || data.jobPostingsData || [];
        if (!jobsFromApi || jobsFromApi.length === 0) {
          hasMore = false;
          break;
        }

        allJobs = allJobs.concat(jobsFromApi);
        offset += limit;

        if (jobsFromApi.length < limit) {
          hasMore = false;
        }
      } catch (err) {
        if (offset === 0) throw err;
        console.log(`[WorkdayCsrfAdapter] Pagination failed at offset ${offset}. Returning ${allJobs.length} jobs.`);
        break;
      }
    }

    return allJobs.map(item => {
      const jobId = item.bulletFields?.[0] || item.externalPath || item.id;
      let jobUrl = item.externalPath ? `${applyBaseUrl}${item.externalPath}` : "";
      if (!jobUrl && jobId) {
         jobUrl = `${applyBaseUrl}/job/${jobId}`;
      }
      return this.normalizeJob({
        title: item.title,
        location: item.locationsText || item.location,
        jobId,
        description: item.title, 
        url: jobUrl,
        postedAt: item.postedOn,
        source: 'workday'
      });
    }).filter(Boolean);
  }
}

module.exports = WorkdayCsrfAdapter;
