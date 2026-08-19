const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * EightfoldAdapter — uses the public Eightfold v2 API (used by Qualcomm, Netflix, etc.)
 *
 * Endpoint: GET https://<careers_domain>/api/apply/v2/jobs
 * Params:   domain=<domain>, q=<keywords>, limit=<n>
 * Response: { positions: [...], count: N }
 */
class EightfoldAdapter extends BaseAdapter {
  get parserName() { return 'Eightfold API'; }
  get parserVersion() { return '1.0.0'; }
  get parserRevisionDate() { return '2026-08-19'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const apiUrl  = config.apiUrl;
    const domain  = config.domain;
    const limit   = config.pageSize || 50;
    const keywords = config.keywords || 'software engineer';

    if (!apiUrl || !domain) {
      const { ScraperError } = require('../../../../utils/errors');
      throw new ScraperError('INVALID_ENDPOINT', 'EightfoldAdapter requires apiUrl and domain in scraperConfig');
    }

    const response = await this.fetch(apiUrl, {
      params: {
        domain: domain,
        q     : keywords,
        limit,
      }
    });

    const positions = response.data?.positions || response.data?.jobs || response.data?.results || [];

    return positions.map(item =>
      this.normalizeJob({
        title         : item.name || item.posting_name,
        location      : (item.locations || [item.location]).filter(Boolean).join(', '),
        jobId         : item.ats_job_id || String(item.id),
        description   : [item.department, item.business_unit].filter(Boolean).join(' — '),
        url           : item.canonicalPositionUrl || '',
        postedAt      : normalizeDate(item.t_create ? new Date(item.t_create * 1000).toISOString() : null),
        employmentType: item.type,
        source        : 'eightfold',
      })
    ).filter(Boolean);
  }
}

module.exports = EightfoldAdapter;
