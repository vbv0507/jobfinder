const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { chromium } = require('playwright-extra');
chromium.use(require('puppeteer-extra-plugin-stealth')());

const { ScraperError, ErrorTypes } = require('./errors');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithAxios = async (url, config, attempt = 1, maxRetries = 3) => {
  try {
    const response = await axios({
      url,
      method: config.method || 'GET',
      headers: config.headers || {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        "Accept": "application/json",
      },
      params: config.params || {},
      data: config.data || null,
      timeout: 25000,
    });
    return { data: response.data, source: 'axios', responseUrl: response.request?.res?.responseUrl || url };
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) throw new ScraperError(ErrorTypes.NOT_FOUND, 'Page not found');
    if (status === 410) throw new ScraperError('410', 'Page gone');
    
    // Exponential backoff for rate limits and intermittent errors
    if (['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code) || 
        error.message.includes('timeout') || 
        status === 429 || status === 503 || status === 403) {
        
        if (attempt < maxRetries) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          console.log(`[Axios] Rate limited/Blocked (${status || error.code}) on ${url}. Retrying in ${backoffTime}ms (Attempt ${attempt}/${maxRetries})...`);
          await sleep(backoffTime);
          return fetchWithAxios(url, config, attempt + 1, maxRetries);
        }
    }
    
    if (status === 403) throw new ScraperError(ErrorTypes.FORBIDDEN, 'Forbidden access');
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      throw new ScraperError(ErrorTypes.TIMEOUT, 'Axios timeout');
    }
    
    throw new ScraperError(ErrorTypes.NETWORK_ERROR, error.message);
  }
};

const fetchWithPuppeteer = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    return { data: content, source: 'puppeteer', responseUrl: url };
  } catch (error) {
    throw new ScraperError(ErrorTypes.UNKNOWN, `Puppeteer failed: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

const fetchWithPlaywright = async (url, useStealth = false) => {
  let browser;
  try {
    const launchOptions = { headless: true, args: ['--no-sandbox'] };
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      userAgent: useStealth ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" : undefined
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    
    // Cloudflare Bypass Detection
    const title = await page.title();
    if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('cloudflare')) {
        console.log(`[Playwright] Cloudflare detected on ${url}, waiting for challenge...`);
        await page.waitForTimeout(6000); // Wait for CF JS challenge
    }

    const content = await page.content();
    return { data: content, source: useStealth ? 'stealth-playwright' : 'playwright', responseUrl: url };
  } catch (error) {
    throw new ScraperError(ErrorTypes.UNKNOWN, `Playwright failed: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

const executeScrapeRequest = async (url, config = {}) => {
  const timings = { axios: 0, puppeteer: 0, playwright: 0, stealthPlaywright: 0 };
  const trail = [];
  let start = Date.now();
  
  try {
    const res = await fetchWithAxios(url, config);
    timings.axios = Date.now() - start;
    trail.push({ stage: "Scraping: Axios", severity: "SUCCESS", message: `Fetched via Axios`, durationMs: timings.axios });
    res.timings = timings;
    res.trail = trail;
    return res;
  } catch (error) {
    timings.axios = Date.now() - start;
    trail.push({ stage: "Scraping: Axios", severity: "WARN", message: `Failed: ${error.message}`, durationMs: timings.axios });
    
    if (error instanceof ScraperError && ['404', '410'].includes(error.type)) {
      error.trail = trail;
      throw error;
    }

    try {
      console.log(`[RetryChain] Axios failed for ${url} (${error.message}), trying Puppeteer...`);
      start = Date.now();
      const res = await fetchWithPuppeteer(url);
      timings.puppeteer = Date.now() - start;
      trail.push({ stage: "Scraping: Puppeteer", severity: "SUCCESS", message: `Fetched via Puppeteer`, durationMs: timings.puppeteer });
      res.timings = timings;
      res.trail = trail;
      return res;
    } catch (puppeteerError) {
      timings.puppeteer = Date.now() - start;
      trail.push({ stage: "Scraping: Puppeteer", severity: "WARN", message: `Failed: ${puppeteerError.message}`, durationMs: timings.puppeteer });
      
      try {
        console.log(`[RetryChain] Puppeteer failed for ${url}, trying Playwright...`);
        start = Date.now();
        const res = await fetchWithPlaywright(url, false);
        timings.playwright = Date.now() - start;
        trail.push({ stage: "Scraping: Playwright", severity: "SUCCESS", message: `Fetched via Playwright`, durationMs: timings.playwright });
        res.timings = timings;
        res.trail = trail;
        return res;
      } catch (playwrightError) {
        timings.playwright = Date.now() - start;
        trail.push({ stage: "Scraping: Playwright", severity: "WARN", message: `Failed: ${playwrightError.message}`, durationMs: timings.playwright });
        
        try {
            console.log(`[RetryChain] Playwright failed for ${url}, trying Stealth Playwright with Cloudflare Bypass...`);
            start = Date.now();
            const res = await fetchWithPlaywright(url, true);
            timings.stealthPlaywright = Date.now() - start;
            trail.push({ stage: "Scraping: Stealth Playwright", severity: "SUCCESS", message: `Fetched via Stealth Playwright`, durationMs: timings.stealthPlaywright });
            res.timings = timings;
            res.trail = trail;
            return res;
        } catch (stealthError) {
            timings.stealthPlaywright = Date.now() - start;
            trail.push({ stage: "Scraping: Stealth Playwright", severity: "ERROR", message: `Failed: ${stealthError.message}`, durationMs: timings.stealthPlaywright });
            
            const err = new ScraperError(ErrorTypes.BLOCKED, 'All fetch methods failed (Blocked by Anti-Bot)');
            err.timings = timings;
            err.trail = trail;
            throw err;
        }
      }
    }
  }
};

module.exports = { executeScrapeRequest };
