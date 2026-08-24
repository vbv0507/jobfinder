const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

class SmartRecruitersAdapter extends BaseAdapter {
  get parserName() { return "SmartRecruiters API"; }
  get parserVersion() { return "1.2.0"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'smartrecruiters',
        urlRegex: /api\.smartrecruiters\.com\/v1\/companies\/[^/]+\/postings/i,
        validatePayload: (json) => json && Array.isArray(json.content)
      }
    ];
  }

  get parserRevisionDate() { return "2026-08-24"; }

  getCountryName(country = "") {
    const value = country.toLowerCase();
    if (value === "in") return "India";
    return country;
  }

  async searchJobs() {
    let url = this.company.scraperConfig?.apiUrl;
    const method = this.company.scraperConfig?.apiMethod || 'GET';
    let headers = this.company.scraperConfig?.apiHeaders ? Object.fromEntries(this.company.scraperConfig.apiHeaders) : {};

    if (!url) {
      const match = this.company.careerUrl.match(/careers\.smartrecruiters\.com\/([^/?]+)/i) || 
                    this.company.careerUrl.match(/smartrecruiters\.com\/([^/?]+)/i);
      if (match && match[1]) {
        url = `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings`;
      } else {
        throw new Error("Unable to build SmartRecruiters API URL");
      }
    }

    // Paginate: SmartRecruiters caps at 100 per page
    const PAGE_SIZE = 100;
    let offset = 0;
    let allJobs = [];
    let totalFound = null;

    while (true) {
      const pageUrl = `${url}?limit=${PAGE_SIZE}&offset=${offset}`;
      const response = await this.fetch(pageUrl, { method, headers, data: null });
      const page = response.data?.content || [];

      if (totalFound === null) {
        totalFound = response.data?.totalFound ?? null;
      }

      allJobs = allJobs.concat(page);
      offset += PAGE_SIZE;

      // Stop if: partial page (last page), all fetched, or safety cap
      if (page.length < PAGE_SIZE) break;
      if (totalFound !== null && allJobs.length >= totalFound) break;
      if (offset >= 1000) break;
    }

    return allJobs.map(item => this.normalizeJob({
      title: item.name,
      location: [
        item.location?.city,
        item.location?.region,
        this.getCountryName(item.location?.country),
        item.location?.remote ? "Remote" : "",
      ].filter(Boolean).join(", "),
      jobId: item.id || item.uuid || item.ref,
      description: [item.name, item.department?.label, item.location?.city, item.location?.country].filter(Boolean).join(" "),
      url: (item.company?.identifier && item.id) 
        ? `https://jobs.smartrecruiters.com/${item.company.identifier}/${item.id}` 
        : (item.ref || item.url),
      employmentType: item.typeOfEmployment?.label,
      postedAt: normalizeDate(item.releasedDate || item.updatedOn),
      source: 'smartrecruiters'
    })).filter(Boolean);
  }
}

module.exports = SmartRecruitersAdapter;
