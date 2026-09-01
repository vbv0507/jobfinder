const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');
const axios = require('axios');

/**
 * InfineonAdapter — Scrapes live jobs from Infineon's official Eightfold PCSX career portal
 * using high-performance direct REST API calls.
 */
class InfineonAdapter extends BaseAdapter {
  get parserName() { return 'Infineon Eightfold PCSX API'; }
  get parserVersion() { return '2.0.0'; }
  get parserRevisionDate() { return '2026-09-01'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const domain = config.domain || 'infineon.com';
    const location = config.location || 'India';
    const query = config.keywords || '';
    const baseUrl = 'https://jobs.infineon.com/api/pcsx/search';

    const PAGE_SIZE = 10;
    const MAX_POSITIONS = 150;
    let start = 0;
    let totalCount = null;
    const allPositions = [];
    const seenIds = new Set();

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://jobs.infineon.com/careers'
    };

    try {
      while (start < MAX_POSITIONS) {
        const url = `${baseUrl}?domain=${encodeURIComponent(domain)}&query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=${start}&num=${PAGE_SIZE}`;
        const response = await axios.get(url, { headers, timeout: 15000 });
        
        const dataObj = response.data?.data || response.data || {};
        const positions = dataObj.positions || [];
        if (totalCount === null && typeof dataObj.count === 'number') {
          totalCount = dataObj.count;
        }

        if (!Array.isArray(positions) || positions.length === 0) {
          break;
        }

        for (const pos of positions) {
          const id = String(pos.id || pos.displayJobId || '');
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            allPositions.push(pos);
          }
        }

        start += PAGE_SIZE;
        if (positions.length < PAGE_SIZE) break;
        if (totalCount !== null && allPositions.length >= totalCount) break;
      }
    } catch (apiError) {
      console.warn(`[InfineonAdapter] PCSX search API failed: ${apiError.message}`);
      if (allPositions.length === 0) {
        throw apiError;
      }
    }

    return allPositions.map(item => {
      const jobId = String(item.id || item.displayJobId || '');
      const jobUrl = item.canonicalPositionUrl || `https://jobs.infineon.com/careers/job/${jobId}`;
      const locationStr = (item.standardizedLocations && item.standardizedLocations.length > 0)
        ? item.standardizedLocations.join(', ')
        : (item.locations ? item.locations.join(', ') : 'India');

      const postedIso = item.postedTs 
        ? new Date(item.postedTs * 1000).toISOString() 
        : (item.creationTs ? new Date(item.creationTs * 1000).toISOString() : new Date().toISOString());

      return this.normalizeJob({
        title: (item.name || '').trim(),
        location: locationStr,
        jobId: jobId,
        description: [item.name, item.department, locationStr, item.displayJobId].filter(Boolean).join(' - '),
        url: jobUrl,
        postedAt: normalizeDate(postedIso),
        postedDate: new Date(postedIso),
        employmentType: item.workLocationOption || 'Full-Time',
        source: 'infineon'
      });
    }).filter(Boolean);
  }
}

module.exports = InfineonAdapter;
