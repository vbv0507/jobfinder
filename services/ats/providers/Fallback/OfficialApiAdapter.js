const BaseAdapter = require('../../BaseAdapter');

class OfficialApiAdapter extends BaseAdapter {
  get parserName() { return "Generic API Parser"; }
  get parserVersion() { return "1.0.0"; }
  get parserRevisionDate() { return "2024-01-01"; }

  getValue(object, path) {
    if (!path) return "";
    return path.split(".").reduce((current, key) => {
      if (!current) return "";
      return current[key];
    }, object);
  }

  async searchJobs() {
    const config = this.company.scraperConfig;
    if (!config || !config.apiUrl) throw new Error('Generic API URL missing');

    const { data } = await this.fetch(config.apiUrl, { params: config.params || {} });
    const jobsFromApi = this.getValue(data, config.listPath);

    if (!Array.isArray(jobsFromApi)) return [];

    return jobsFromApi.map(item => {
      const fields = config.fields || {};
      let url = "";
      if (config.applyUrlBase && fields.jobId) {
        url = `${config.applyUrlBase}/${this.getValue(item, fields.jobId)}`;
      } else {
        url = this.getValue(item, fields.applyLink);
      }

      return this.normalizeJob({
        title: this.getValue(item, fields.title),
        location: this.getValue(item, fields.location),
        jobId: this.getValue(item, fields.jobId),
        experience: this.getValue(item, fields.experience),
        description: [
          this.getValue(item, fields.department),
          this.getValue(item, fields.function),
          this.getValue(item, fields.location),
        ].filter(Boolean).join(" "),
        url,
        employmentType: this.getValue(item, fields.employmentType),
        postedAt: this.getValue(item, fields.postedAt),
        source: 'generic_api'
      });
    }).filter(Boolean);
  }
}

module.exports = OfficialApiAdapter;
