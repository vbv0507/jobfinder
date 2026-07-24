const BaseAdapter = require('../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

class GreenhouseAdapter extends BaseAdapter {
  get parserName() { return "Greenhouse API"; }
  get parserVersion() { return "1.1.0"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'greenhouse',
        urlRegex: /boards-api\.greenhouse\.io\/v1\/boards\/[^/]+\/jobs/i,
        validatePayload: (json) => json && Array.isArray(json.jobs)
      }
    ];
  }

  get parserRevisionDate() { return "2024-01-01"; }

  getMetadataValue(metadata = [], name) {
    const item = metadata.find(entry => entry.name === name);
    if (!item) return "";
    return Array.isArray(item.value) ? item.value.join(", ") : item.value;
  }

  async searchJobs() {
    let url = this.company.scraperConfig?.apiUrl;
    const method = this.company.scraperConfig?.apiMethod || 'GET';
    let headers = this.company.scraperConfig?.apiHeaders ? Object.fromEntries(this.company.scraperConfig.apiHeaders) : {};
    const data = this.company.scraperConfig?.apiPayload || null;

    if (!url) {
      // Fallback for legacy setups
      const match = this.company.careerUrl.match(/boards\.greenhouse\.io\/([^/?]+)/i) || 
                    this.company.careerUrl.match(/for=([^&]+)/i);
      if (match && match[1] && match[1] !== 'embed') {
        url = `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs?content=true`;
      } else {
        throw new Error("Unable to build Greenhouse API URL");
      }
    }

    const response = await this.fetch(url, { method, headers, data });
    const jobsFromApi = response.data?.jobs || response.data || [];

    return jobsFromApi.map(item => {
      const officeNames = (item.offices || []).map(o => o.name).join(", ");
      const departmentNames = (item.departments || []).map(d => d.name).join(", ");
      const postingLocation = this.getMetadataValue(item.metadata || [], "Job Posting Location");

      return this.normalizeJob({
        title: item.title,
        location: [item.location?.name, postingLocation, officeNames].filter(Boolean).join(", "),
        jobId: item.id?.toString(),
        description: [item.content, departmentNames, officeNames, postingLocation].filter(Boolean).join(" "),
        employmentType: item.metadata?.find(m => m.name === 'Employment Type')?.value || null,
        url: item.absolute_url,
        postedAt: normalizeDate(item.first_published || item.updated_at),
        source: 'greenhouse'
      });
    }).filter(Boolean);
  }
}

module.exports = GreenhouseAdapter;
