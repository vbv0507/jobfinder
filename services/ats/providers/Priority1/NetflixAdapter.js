const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * NetflixAdapter — uses the public explore.jobs.netflix.net API.
 *
 * Endpoint: GET https://explore.jobs.netflix.net/api/apply/v2/jobs
 * Params:   domain=netflix.com, q=<keywords>, limit=<n>
 * Response: { positions: [...], count: N }
 *
 * Job shape:
 *   id, name, location, locations[], department, business_unit,
 *   canonicalPositionUrl, ats_job_id, t_create, t_update
 */
class NetflixAdapter extends BaseAdapter {
  get parserName() { return 'Netflix Jobs API'; }
  get parserVersion() { return '1.0.0'; }
  get parserRevisionDate() { return '2026-08-19'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const apiUrl  = config.apiUrl || 'https://explore.jobs.netflix.net/api/apply/v2/jobs';
    const limit   = config.pageSize || 50;
    const keywords = config.keywords || 'software engineer';

    const response = await this.fetch(apiUrl, {
      params: {
        domain: 'netflix.com',
        q     : keywords,
        limit,
      }
    });

    const positions = response.data?.positions || [];

    return positions.map(item =>
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
