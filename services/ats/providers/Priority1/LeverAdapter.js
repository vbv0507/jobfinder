const BaseAdapter = require('../../BaseAdapter');

class LeverAdapter extends BaseAdapter {
  get parserName() { return "Lever API"; }
  get parserVersion() { return "1.1.0"; }

  static get NetworkSignatures() {
    return [
      {
        ats: 'lever',
        urlRegex: /api\.lever\.co\/v0\/postings\/[^/?]+/i,
        validatePayload: (json) => Array.isArray(json) && json[0] && json[0].id
      }
    ];
  }

  get parserRevisionDate() { return "2024-01-01"; }

  async searchJobs() {
    let url = this.company.scraperConfig?.apiUrl;
    const method = this.company.scraperConfig?.apiMethod || 'GET';
    let headers = this.company.scraperConfig?.apiHeaders ? Object.fromEntries(this.company.scraperConfig.apiHeaders) : {};
    const data = this.company.scraperConfig?.apiPayload || null;
    
    if (!url) {
      const match = this.company.careerUrl.match(/jobs\.lever\.co\/([^/?]+)/i);
      if (match && match[1]) {
        url = `https://api.lever.co/v0/postings/${match[1]}?mode=json`;
      } else {
        throw new Error("Unable to build Lever API URL");
      }
    }

    const response = await this.fetch(url, { method, headers, data });
    const jobsFromApi = Array.isArray(response.data) ? response.data : [];

    return jobsFromApi.map(item => {
      const lists = (item.lists || []).map(l => `${l.text || ""} ${l.content || ""}`).join(" ");

      return this.normalizeJob({
        title: item.text,
        location: item.categories?.location || "Not specified",
        jobId: item.id?.toString(),
        description: [item.descriptionPlain, lists, item.categories?.team, item.categories?.commitment].filter(Boolean).join(" "),
        url: item.hostedUrl || item.applyUrl,
        employmentType: item.categories?.commitment,
        postedAt: item.createdAt,
        source: 'lever'
      });
    }).filter(Boolean);
  }
}

module.exports = LeverAdapter;
