const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');
const { launchBrowser } = require('../../../browserManager');

/**
 * AdpAdapter — Scrapes live jobs from ADP's official career portal
 * using the cloud-resilient BrowserManager (Puppeteer Stealth + On-the-fly binary installation).
 */
class AdpAdapter extends BaseAdapter {
  get parserName() { return 'ADP Career Portal Parser'; }
  get parserVersion() { return '1.2.0'; }
  get parserRevisionDate() { return '2026-08-31'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const careerUrl = config.searchUrl || this.company.careerUrl || 'https://jobs.adp.com/en/jobs/';
    
    // Ensure we query India / Tech jobs by default if not parameterized
    let targetUrl = careerUrl;
    if (!targetUrl.includes('mylocation=') && !targetUrl.includes('search=')) {
      targetUrl = 'https://jobs.adp.com/en/jobs/?orderby=0&pagesize=50&page=1&mylocation=India&radius=100&rType=0';
    }

    let browser = null;
    const rawJobs = [];

    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1440, height: 900 });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('h2.card-title, [class*="card-title"]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const extracted = await page.evaluate(() => {
        const results = [];
        const cardTitles = Array.from(document.querySelectorAll('h2.card-title, [class*="card-title"]'));

        cardTitles.forEach(h2 => {
          const a = h2.querySelector('a') || h2.closest('a');
          if (!a) return;
          const title = h2.innerText.trim();
          const url = a.href;

          const card = h2.closest('.card, .job-item, [class*="card"], li, div.position-relative') || h2.parentElement;
          const cardText = card ? card.innerText.replace(/\s+/g, ' ').trim() : '';

          let location = "India";
          if (cardText.includes("Hyderabad")) location = "Hyderabad, Telangana, India";
          else if (cardText.includes("Pune")) location = "Pune, Maharashtra, India";
          else if (cardText.includes("Chennai")) location = "Chennai, Tamil Nadu, India";
          else if (cardText.includes("Gurgaon") || cardText.includes("Gurugram")) location = "Gurgaon, Haryana, India";
          else if (cardText.includes("Noida")) location = "Noida, Uttar Pradesh, India";
          else if (cardText.includes("Bengaluru") || cardText.includes("Bangalore")) location = "Bengaluru, Karnataka, India";

          const dateMatch = cardText.match(/(\d{2}\/\d{2}\/\d{4})/);
          const postedDateStr = dateMatch ? dateMatch[1] : null;

          const idMatch = url.match(/\/jobs\/([a-zA-Z0-9]+)\//) || cardText.match(/\bind(\d+)\b/);
          const jobId = idMatch ? idMatch[1] : '';

          if (title && title.length > 2) {
            results.push({
              title,
              url,
              location,
              postedDateStr,
              jobId,
              description: cardText || title
            });
          }
        });

        return results;
      });

      rawJobs.push(...extracted);
      await page.close().catch(() => {});
    } catch (err) {
      console.warn(`[AdpAdapter] Browser extraction encountered an issue: ${err.message}`);
      if (err.message && (err.message.includes('Failed to launch the browser process') || err.message.includes('shared libraries') || err.message.includes('libnspr4'))) {
        console.warn(`[AdpAdapter] Linux container missing Chromium dependencies. Returning empty list gracefully.`);
        return [];
      }
      throw err;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    const seenUrls = new Set();
    const uniqueJobs = [];
    for (const item of rawJobs) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueJobs.push(item);
      }
    }

    return uniqueJobs.map(item =>
      this.normalizeJob({
        title: item.title,
        location: item.location,
        jobId: item.jobId,
        description: item.description,
        url: item.url,
        postedAt: normalizeDate(item.postedDateStr),
        postedDate: item.postedDateStr ? new Date(item.postedDateStr) : new Date(),
        employmentType: 'Full-Time',
        source: 'adp'
      })
    ).filter(Boolean);
  }
}

module.exports = AdpAdapter;
