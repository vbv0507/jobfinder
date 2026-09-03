const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * AmazonAdapter — uses the public amazon.jobs search JSON API.
 *
 * Endpoint: GET https://www.amazon.jobs/en/search.json
 * Params:   query=<keywords>, sort=relevant, country_codes[]=IN
 * Response: { jobs: [...], hits: N }
 *
 * Job shape:
 *   id, title, location, locations[], description_short, city,
 *   job_path, posted_date, job_category, job_schedule_type, country_code
 */
class AmazonAdapter extends BaseAdapter {
  get parserName() { return 'Amazon Jobs API'; }
  get parserVersion() { return '1.0.0'; }
  get parserRevisionDate() { return '2026-08-19'; }

  async searchJobs() {
    const config   = this.company.scraperConfig || {};
    const apiUrl   = config.apiUrl || 'https://www.amazon.jobs/en/search.json';
    const keywords = config.keywords || 'software development engineer';
    const country  = config.country || 'IN';
    const location = config.location || 'India';

    // Amazon paginates with offset; cap at 200 for safety
    const PAGE = 10; // amazon returns 10 per page max
    let offset = 0;
    let allJobs = [];
    let totalHits = null;

    while (offset < 200) {
      const response = await this.fetch(apiUrl, {
        params: {
          query : keywords,
          sort  : 'relevant',
          offset,
        }
      });

      const page = response.data?.jobs || [];
      if (page.length === 0) break;

      if (totalHits === null) totalHits = response.data?.hits || 0;
      allJobs = allJobs.concat(page);
      offset += PAGE;

      if (page.length < PAGE || allJobs.length >= totalHits) break;
    }

    return allJobs.map(item => {
      const basicQuals = (item.basic_qualifications || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const preferredQuals = (item.preferred_qualifications || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const mainDesc = (item.description || item.description_short || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      const fullDescription = [
        mainDesc,
        basicQuals ? `Basic Qualifications:\n${basicQuals}` : '',
        preferredQuals ? `Preferred Qualifications:\n${preferredQuals}` : ''
      ].filter(Boolean).join('\n\n');

      // Extract explicit years of experience from basic_qualifications
      const expMatch = basicQuals.match(/(\d+)\+?\s*years?\s*(?:of)?\s*(?:non-internship|professional|software|development|engineering|industry)?/i);
      const experience = expMatch ? `${expMatch[1]}+ years` : '';

      return this.normalizeJob({
        title         : item.title,
        location      : [item.city, item.location].filter(Boolean).join(', ') || (item.locations || []).join(', '),
        jobId         : item.id || item.id_icims,
        experience    : experience,
        description   : fullDescription,
        url           : item.job_path ? `https://www.amazon.jobs${item.job_path}` : '',
        postedAt      : normalizeDate(item.posted_date || item.updated_time),
        employmentType: item.job_schedule_type,
        source        : 'amazon',
      });
    }).filter(Boolean);
  }
}

module.exports = AmazonAdapter;
