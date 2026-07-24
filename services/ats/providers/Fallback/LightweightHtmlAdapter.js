const BaseAdapter = require('../../BaseAdapter');
const cheerio = require('cheerio');

class LightweightHtmlAdapter extends BaseAdapter {
  get parserName() { return "Custom Multi-Framework Parser"; }
  get parserVersion() { return "2.1.0"; }
  get parserRevisionDate() { return "2024-10-25"; }

  async searchJobs() {
    const { data } = await this.fetch(this.company.careerUrl);
    const $ = cheerio.load(data);
    const jobs = [];
    let sourceUsed = 'custom';
    
    // 1. JSON-LD
    $("script[type='application/ld+json']").each((i, el) => {
        try {
            const parsed = JSON.parse($(el).html() || $(el).text());
            const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
            items.forEach(item => {
                if (item["@type"] === "JobPosting") {
                    jobs.push({ title: item.title, url: item.url || this.company.careerUrl, source: 'custom_json_ld' });
                    sourceUsed = 'json_ld';
                }
            });
        } catch (e) {}
    });

    // Extract raw text for regex searching
    const rawHtml = data.toString();

    // 2. NextJS Hydration
    if (jobs.length === 0) {
      const nextMatch = rawHtml.match(/__NEXT_DATA__\s*=\s*(\{.*?\});/);
      if (nextMatch) {
         // rough parse, we won't fully traverse, just grab titles and urls using regex for safety
         try {
           const jsonStr = nextMatch[1];
           const titles = [...jsonStr.matchAll(/"title":"([^"]+)"/g)];
           const urls = [...jsonStr.matchAll(/"url":"([^"]+)"/g)];
           if (titles.length > 0) {
             for (let i = 0; i < titles.length; i++) {
               jobs.push({ title: titles[i][1], url: urls[i]?.[1] || this.company.careerUrl, source: 'nextjs' });
             }
             sourceUsed = 'nextjs_hydration';
           }
         } catch(e) {}
      }
    }

    // 3. Nuxt Hydration
    if (jobs.length === 0) {
      const nuxtMatch = rawHtml.match(/window\.__NUXT__\s*=\s*(.*);/);
      if (nuxtMatch && nuxtMatch[1].includes('title')) {
         sourceUsed = 'nuxt_hydration';
         // We will fallback to generic scraper if it doesn't parse well, but let's record it
      }
    }

    // 4. Apollo State
    if (jobs.length === 0) {
      const apolloMatch = rawHtml.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\});/);
      if (apolloMatch && apolloMatch[1].includes('title')) {
        sourceUsed = 'apollo_state';
      }
    }

    // 5. Traditional HTML Selectors
    if (jobs.length === 0) {
      $("a").each((i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && (href.includes('/job/') || href.includes('/careers/') || href.includes('/position/')) && text.length > 5) {
          let absoluteUrl = href;
          if (!href.startsWith('http')) {
            try { absoluteUrl = new URL(href, this.company.careerUrl).toString(); } catch(e) {}
          }
          jobs.push({ title: text, url: absoluteUrl, source: 'custom_html' });
        }
      });
      if (jobs.length > 0) sourceUsed = 'traditional_html';
    }

    const normalizedJobs = jobs.map(j => this.normalizeJob(j)).filter(Boolean);

    if (normalizedJobs.length === 0) {
      const pageText = $("body").text().toLowerCase();
      if (pageText.includes('apply') || pageText.includes('job') || pageText.includes('role') || pageText.includes('career')) {
        // Will be thrown up by scraperService
      }
    }

    return normalizedJobs;
  }
}

module.exports = LightweightHtmlAdapter;
