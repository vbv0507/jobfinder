const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');

/**
 * PlaywrightNetworkAdapter
 * 
 * Uses Playwright to launch a real browser, navigates to the company career page,
 * and intercepts the network responses matching a JSON pattern.
 * 
 * This is used for companies (Google, Meta, Apple, Microsoft) that:
 * - Have WAF/bot-protection blocking direct API calls
 * - Require session cookies or CSRF tokens only a real browser can obtain
 * - Use dynamic React/Angular frontends that require JS execution
 * 
 * scraperConfig fields:
 *   careerPageUrl   : page to navigate (defaults to company.careerUrl)
 *   apiUrlPattern   : regex string to match the network request URL (required)
 *   jobsPath        : dot-path to extract jobs array from response JSON (e.g. 'data.jobs')
 *   fieldMap        : { title, location, url, jobId, postedAt, description }
 *   waitForSelector : CSS selector to wait for before capturing (optional)
 *   waitMs          : ms to wait after page load (default 3000)
 *   scrollPages     : how many times to scroll to load more jobs (default 0)
 */
class PlaywrightNetworkAdapter extends BaseAdapter {
  get parserName() { return 'Playwright Network Interceptor'; }
  get parserVersion() { return '1.0.0'; }
  get parserRevisionDate() { return '2026-08-20'; }

  /** Resolve nested dot-path like "data.jobs" on an object */
  _getPath(obj, dotPath) {
    if (!dotPath) return obj;
    return dotPath.split('.').reduce((acc, key) => acc && acc[key], obj);
  }

  async searchJobs() {
    const { chromium } = require('playwright');
    const config = this.company.scraperConfig || {};

    const careerPageUrl  = config.careerPageUrl  || this.company.careerUrl;
    const apiUrlPattern  = config.apiUrlPattern;    // e.g. "careers.google.com/api"
    const jobsPath       = config.jobsPath;         // e.g. "jobs"
    const fieldMap       = config.fieldMap || {};
    const waitSelector   = config.waitForSelector;
    const waitMs         = config.waitMs ?? 4000;
    const scrollPages    = config.scrollPages ?? 0;

    if (!apiUrlPattern) {
      const { ScraperError } = require('../../../../utils/errors');
      throw new ScraperError('INVALID_ENDPOINT', 'PlaywrightNetworkAdapter requires apiUrlPattern in scraperConfig');
    }

    const urlRegex = new RegExp(apiUrlPattern, 'i');
    const capturedResponses = [];
    let browser = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
      });

      const page = await context.newPage();

      // Intercept responses matching the API pattern
      page.on('response', async (response) => {
        try {
          if (urlRegex.test(response.url()) && response.status() === 200) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('json')) {
              const json = await response.json().catch(() => null);
              if (json) capturedResponses.push(json);
            }
          }
        } catch (_) { /* ignore decode errors */ }
      });

      await page.goto(careerPageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
      }
      await page.waitForTimeout(waitMs);

      // Scroll to trigger lazy-loading of more jobs
      for (let i = 0; i < scrollPages; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
      }

      await page.close().catch(() => {});
      await context.close().catch(() => {});
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    if (capturedResponses.length === 0) {
      console.log(`[PlaywrightNetworkAdapter][${this.company.name}] No API responses captured matching: ${apiUrlPattern}`);
      return [];
    }

    // Merge all captured responses into one jobs array
    let allJobs = [];
    for (const response of capturedResponses) {
      const arr = this._getPath(response, jobsPath);
      if (Array.isArray(arr)) {
        allJobs = allJobs.concat(arr);
      }
    }

    console.log(`[PlaywrightNetworkAdapter][${this.company.name}] Captured ${capturedResponses.length} response(s), ${allJobs.length} total jobs`);

    return allJobs.map(item => {
      const get = (field) => {
        const key = fieldMap[field];
        if (!key) return undefined;
        return key.includes('.') ? this._getPath(item, key) : item[key];
      };

      return this.normalizeJob({
        title       : get('title')       || item.title || item.name || item.text,
        location    : get('location')    || item.location || item.locations?.[0] || '',
        jobId       : get('jobId')       || item.id || item.jobId,
        description : get('description') || item.description || item.summary || '',
        url         : get('url')         || item.url || item.applyUrl || item.canonicalUrl || '',
        postedAt    : normalizeDate(get('postedAt') || item.postedAt || item.datePosted || item.created),
        source      : this.company.name.toLowerCase().replace(/\s+/g, '_'),
      });
    }).filter(Boolean);
  }
}

module.exports = PlaywrightNetworkAdapter;
