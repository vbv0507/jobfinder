const BaseAdapter = require('../../BaseAdapter');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

const CAREER_JOB_PATH_PATTERN = /\/(?:job|jobs|career|careers|position|positions|opening|openings|role|roles)\/[^/#?]+/i;
const NON_TITLE_TEXT = /^(read more|apply|apply now|view|view role|learn more|software engineering|business development|presales|product|human resource management)$/i;
const CATEGORY_PREFIX_PATTERN = /^(software engineering|business development|presales|product|human resource management)(?=[A-Z])/i;

const looksLikeCareerPage = ($) => {
  const text = $("body").text().toLowerCase();
  return /\b(apply|job|jobs|role|roles|career|careers|opening|openings|position|positions|experience)\b/.test(text);
};

const resolveUrl = (href, baseUrl) => {
  if (!href) return "";
  if (href.startsWith('http')) return href;
  try { return new URL(href, baseUrl).toString(); } catch(e) { return href; }
};

const cleanText = (value = "") => value.replace(/\s+/g, " ").trim();

const stripCategoryPrefix = (value = "") => cleanText(value).replace(CATEGORY_PREFIX_PATTERN, "").trim();

const normalizeJobUrl = (value = "", baseUrl = "") => {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch (e) {
    return value;
  }
};

const dedupeJobsByUrl = (jobs = [], baseUrl = "") => {
  const byUrl = new Map();

  jobs.forEach((job) => {
    const normalizedUrl = normalizeJobUrl(job.url || job.applyLink || "", baseUrl);
    if (!normalizedUrl) return;

    const existing = byUrl.get(normalizedUrl);
    if (!existing) {
      byUrl.set(normalizedUrl, { ...job, url: normalizedUrl, applyLink: normalizedUrl });
      return;
    }

    if ((job.title || "").length > (existing.title || "").length) {
      byUrl.set(normalizedUrl, { ...existing, ...job, url: normalizedUrl, applyLink: normalizedUrl });
    }
  });

  return [...byUrl.values()];
};

const extractExperience = (text = "") => {
  const compactText = cleanText(text);
  const directMatch = compactText.match(/Experience\s*[:\-]\s*([0-9]+(?:\s*-\s*[0-9]+)?(?:\s*(?:years?|yrs?))?)/i);
  if (directMatch) return cleanText(directMatch[1]);

  const fallbackMatch = compactText.match(/Experience\s*:\s*([^\n\r]+?)(?:Read More|Apply|$)/i);
  return fallbackMatch ? cleanText(fallbackMatch[1]) : "";
};

const extractTitleFromCard = (anchorText = "", cardText = "") => {
  const cleanAnchor = stripCategoryPrefix(anchorText);
  if (cleanAnchor.length > 5 && !NON_TITLE_TEXT.test(cleanAnchor)) {
    return cleanAnchor;
  }

  const compact = cleanText(cardText);
  const beforeExperience = compact.split(/Experience\s*:/i)[0] || compact;
  const parts = beforeExperience
    .split(/\s{2,}|(?<=\b(?:ENGINEERING|DEVELOPMENT|PRESALES|PRODUCT|MANAGEMENT))\s+/i)
    .map(cleanText)
    .map(stripCategoryPrefix)
    .filter(Boolean)
    .filter(part => !NON_TITLE_TEXT.test(part));

  return stripCategoryPrefix(parts[parts.length - 1] || cleanAnchor);
};

class LightweightHtmlAdapter extends BaseAdapter {
  get parserName() { return "Custom Multi-Framework Parser"; }
  get parserVersion() { return "2.2.0"; }
  get parserRevisionDate() { return "2024-10-25"; }

  extractTraditionalHtmlJobs($, source = 'custom_html') {
    const byUrl = new Map();

    $("a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      const absoluteUrl = resolveUrl(href, this.company.careerUrl);
      const path = (() => {
        try { return new URL(absoluteUrl).pathname; } catch(e) { return href; }
      })();

      const anchorText = cleanText($(el).text());
      const cardText = cleanText($(el).closest("article, section, li, .card, [class*='card'], [class*='job'], [class*='career'], div").text());
      const title = extractTitleFromCard(anchorText, cardText);

      if (!CAREER_JOB_PATH_PATTERN.test(path) || title.length <= 5 || NON_TITLE_TEXT.test(title)) return;

      const existing = byUrl.get(absoluteUrl);
      if (!existing || title.length > existing.title.length) {
        byUrl.set(absoluteUrl, {
          title,
          url: absoluteUrl,
          description: cardText || title,
          experience: extractExperience(cardText),
          source
        });
      }
    });

    return [...byUrl.values()];
  }

  async fetchRenderedHtml() {
    let browser = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
      });
      const page = await browser.newPage({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        viewport: { width: 1440, height: 1200 }
      });
      await page.goto(this.company.careerUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(2500);
      const html = await page.content();
      await page.close().catch(() => {});
      return html;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  async searchJobs() {
    const { data } = await this.fetch(this.company.careerUrl);
    let $ = cheerio.load(data);
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
      jobs.push(...this.extractTraditionalHtmlJobs($, 'custom_html'));
      if (jobs.length > 0) sourceUsed = 'traditional_html';
    }

    if (jobs.length === 0 && looksLikeCareerPage($)) {
      try {
        const renderedHtml = await this.fetchRenderedHtml();
        $ = cheerio.load(renderedHtml);
        jobs.push(...this.extractTraditionalHtmlJobs($, 'rendered_html'));
        if (jobs.length > 0) sourceUsed = 'rendered_html';
        this.trail = this.trail || [];
        this.trail.push({
          stage: 'Rendered DOM fallback',
          severity: jobs.length > 0 ? 'SUCCESS' : 'WARN',
          message: jobs.length > 0 ? `Extracted ${jobs.length} jobs after JavaScript render` : 'No jobs found after JavaScript render'
        });
      } catch (error) {
        this.trail = this.trail || [];
        this.trail.push({
          stage: 'Rendered DOM fallback',
          severity: 'WARN',
          message: `Browser render fallback failed: ${error.message}`
        });
      }
    }

    const dedupedJobs = dedupeJobsByUrl(jobs, this.company.careerUrl);
    const normalizedJobs = dedupedJobs.map(j => this.normalizeJob(j)).filter(Boolean);

    return normalizedJobs;
  }
}

module.exports = LightweightHtmlAdapter;
