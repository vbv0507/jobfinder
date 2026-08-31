const BaseAdapter = require('../../BaseAdapter');
const { normalizeDate } = require('../../../../utils/dateNormalizer');
const { launchBrowser } = require('../../../browserManager');

/**
 * InfineonAdapter — Scrapes live jobs from Infineon's Eightfold PCSX career portal
 * using the cloud-resilient BrowserManager.
 */
class InfineonAdapter extends BaseAdapter {
  get parserName() { return 'Infineon Eightfold Parser'; }
  get parserVersion() { return '1.1.0'; }
  get parserRevisionDate() { return '2026-08-31'; }

  async searchJobs() {
    const config = this.company.scraperConfig || {};
    const keywords = config.keywords || 'software';
    const location = config.location || 'India';
    
    const targetUrl = config.searchUrl || 
      `https://jobs.infineon.com/careers?query=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&sort_by=relevance`;

    let browser = null;
    const rawJobs = [];

    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1440, height: 900 });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('a[href*="/job/"]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const extracted = await page.evaluate(() => {
        const results = [];
        const links = Array.from(document.querySelectorAll('a[href*="/job/"]'));
        
        links.forEach(a => {
          const url = a.href;
          const text = a.innerText.trim();
          const card = a.closest('[class*="card"], [class*="position"], [class*="job"], li, div') || a;
          const cardText = card.innerText.replace(/\s+/g, ' ').trim();

          const lines = a.innerText.split('\n').map(s => s.trim()).filter(Boolean);
          const title = lines[0] || text;
          const loc = lines[1] || 'India';
          const refId = lines[2] || '';

          const urlMatch = url.match(/\/job\/([0-9a-zA-Z]+)/);
          const jobId = urlMatch ? urlMatch[1] : (refId || '');

          if (title && title.length > 3 && !title.toLowerCase().includes('job search') && !title.toLowerCase().includes('join talent')) {
            results.push({
              title,
              url,
              location: loc.includes('India') ? loc : `${loc}, India`,
              jobId,
              description: cardText || `${title} - ${loc} ${refId}`
            });
          }
        });
        return results;
      });

      rawJobs.push(...extracted);
      await page.close().catch(() => {});
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
        postedAt: normalizeDate(new Date().toISOString()),
        postedDate: new Date(),
        employmentType: 'Full-Time',
        source: 'infineon'
      })
    ).filter(Boolean);
  }
}

module.exports = InfineonAdapter;
