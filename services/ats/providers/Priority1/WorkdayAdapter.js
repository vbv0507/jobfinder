const BaseAdapter = require('../../BaseAdapter');

class WorkdayAdapter extends BaseAdapter {
  get parserName() { return "Workday GraphQL/API"; }
  get parserVersion() { return "2.1.0"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'workday',
        urlRegex: /\/wday\/cxs\/[^/]+\/[^/]+\/jobs/i,
        validatePayload: (json) => json && Array.isArray(json.jobPostings)
      }
    ];
  }

  get parserRevisionDate() { return "2024-10-15"; }

  async searchJobs() {
    const apiUrl = this.company.scraperConfig?.apiUrl;
    const method = this.company.scraperConfig?.apiMethod || 'POST';
    const headers = this.company.scraperConfig?.apiHeaders ? Object.fromEntries(this.company.scraperConfig.apiHeaders) : { "Content-Type": "application/json" };
    let dataPayload = this.company.scraperConfig?.apiPayload || { appliedFacets: {}, limit: 50, offset: 0 };
    
    if (!apiUrl) {
       const { ScraperError } = require('../../../../utils/errors');
       throw new ScraperError('INVALID_ENDPOINT', 'Workday API endpoint not configured');
    }

    const limit = dataPayload.limit || 50;
    let offset = dataPayload.offset || 0;
    let allJobs = [];
    let hasMore = true;

    let applyBaseUrl = this.company.careerUrl;
    const match = apiUrl.match(/https:\/\/(.+?)\/wday\/cxs\/[^\/]+\/([^\/]+)/);
    if (match) {
      applyBaseUrl = `https://${match[1]}/en-US/${match[2]}`;
    }

    while (hasMore && offset < 200) { // Safety cap of 200 jobs max
      try {
        dataPayload.limit = limit;
        dataPayload.offset = offset;

        const { data } = await this.fetch(apiUrl, { method, headers, data: dataPayload });

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
        console.log(`[Workday] Pagination failed at offset ${offset}. Returning ${allJobs.length} jobs.`);
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

module.exports = WorkdayAdapter;
