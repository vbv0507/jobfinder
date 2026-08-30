const GreenhouseAdapter = require('./providers/Priority1/GreenhouseAdapter');
const LeverAdapter = require('./providers/Priority1/LeverAdapter');
const AshbyAdapter = require('./providers/Priority1/AshbyAdapter');
const WorkdayAdapter = require('./providers/Priority1/WorkdayAdapter');
const WorkdayCsrfAdapter = require('./providers/Priority1/WorkdayCsrfAdapter');
const SmartRecruitersAdapter = require('./providers/Priority1/SmartRecruitersAdapter');
const NetflixAdapter = require('./providers/Priority1/NetflixAdapter');
const AmazonAdapter = require('./providers/Priority1/AmazonAdapter');
const EightfoldAdapter = require('./providers/Priority1/EightfoldAdapter');
const PlaywrightNetworkAdapter = require('./providers/Priority2/PlaywrightNetworkAdapter');
const OfficialApiAdapter = require('./providers/Fallback/OfficialApiAdapter');
const LightweightHtmlAdapter = require('./providers/Fallback/LightweightHtmlAdapter');

class AdapterFactory {
  /**
   * Evaluates company ATS configuration and returns the appropriate adapter instance.
   * Priority: Official ATS -> Official API -> HTML Fallback
   */
  static getAdapter(company) {
    const ats = (company.ats || 'custom').toLowerCase();
    
    // Allow explicit override
    if (company.adapter) {
      if (company.adapter === 'OfficialApiAdapter') return new OfficialApiAdapter(company);
      if (company.adapter === 'LightweightHtmlAdapter') return new LightweightHtmlAdapter(company);
      // Can add more explicit overrides as needed
    }

    switch (ats) {
      case 'greenhouse':
        return new GreenhouseAdapter(company);
      case 'lever':
        return new LeverAdapter(company);
      case 'ashby':
        return new AshbyAdapter(company);
      case 'workday':
        return new WorkdayAdapter(company);
      case 'workday-csrf':
        return new WorkdayCsrfAdapter(company);
      case 'smartrecruiters':
        return new SmartRecruitersAdapter(company);
      case 'netflix':
        return new NetflixAdapter(company);
      case 'amazon':
        return new AmazonAdapter(company);
      case 'eightfold':
        return new EightfoldAdapter(company);
      case 'playwright-network':
        return new PlaywrightNetworkAdapter(company);
      case 'api':
      case 'officialapi':
        return new OfficialApiAdapter(company);
      case 'custom':
      default:
        // Use the fallback chain entry point (starting with HTML for custom logic)
        return new LightweightHtmlAdapter(company);
    }
  }

  static getNetworkSignatures() {
    return [
      ...GreenhouseAdapter.NetworkSignatures,
      ...LeverAdapter.NetworkSignatures,
      ...AshbyAdapter.NetworkSignatures,
      ...WorkdayAdapter.NetworkSignatures,
      ...SmartRecruitersAdapter.NetworkSignatures
    ];
  }
}

module.exports = AdapterFactory;
