const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * NetflixAdapter — uses the public explore.jobs.netflix.net API.
 *
 * Endpoint: GET https://explore.jobs.netflix.net/api/apply/v2/jobs
 * Params:   domain=netflix.com, q=<keywords>, limit=<n>, offset=<n>
 * Response: { positions: [...], count: N }
 *
 * Strategy: Run multiple targeted keyword searches to maximise relevant
 * job discovery (single empty `q` returns mostly US roles).
 */
class NetflixAdapter extends BaseAdapter {
  get parserName() { return 'Netflix Jobs API'; }
  get parserVersion() { return '2.0.0'; }
  get parserRevisionDate() { return '2026-08-24'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const apiUrl = config.apiUrl || 'https://explore.jobs.netflix.net/api/apply/v2/jobs';
    const PAGE_SIZE = 100;

    // Use company targetKeywords or fall back to sensible defaults
    const searchTerms = (config.searchTerms && config.searchTerms.length > 0)
      ? config.searchTerms
      : ['software engineer', 'backend', 'developer', 'sde'];

    const seenIds = new Set();
    const allPositions = [];

    for (const term of searchTerms) {
      let offset = 0;
      while (true) {
        const response = await this.fetch(apiUrl, {
          params: {
            domain: 'netflix.com',
            q: term,
            limit: PAGE_SIZE,
            offset,
          }
        });

        const positions = response.data?.positions || [];
        const total = response.data?.count ?? 0;

        for (const item of positions) {
          const id = item.ats_job_id || String(item.id);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allPositions.push(item);
          }
        }

        offset += PAGE_SIZE;

        // Stop paginating this term if: we got a partial page or fetched all
        if (positions.length < PAGE_SIZE) break;
        if (offset >= total) break;
        // Safety cap per search term
        if (offset >= 500) break;
      }
    }

    return allPositions.map(item =>
      this.normalizeJob({
        title         : item.name || item.posting_name,
        location      : (item.locations || [item.location]).filter(Boolean).join(', '),
        jobId         : item.ats_job_id || String(item.id),
        description   : [item.department, item.business_unit].filter(Boolean).join(' — '),
        url           : item.canonicalPositionUrl || '',
        postedAt      : normalizeDate(item.t_create ? new Date(item.t_create * 1000).toISOString() : null),
        employmentType: item.type,
        source        : 'netflix',
      })
    ).filter(Boolean);
  }
}

module.exports = NetflixAdapter;
