const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { chromium } = require('playwright-extra');
chromium.use(require('puppeteer-extra-plugin-stealth')());

const { ScraperError, ErrorTypes } = require('./errors');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15"
];
const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const isBlocked = (status, data, errorMsg = "") => {
    if (status === 429 || status === 403 || status === 401) return true;
    const d = (typeof data === 'string' ? data : '').toLowerCase();
    const e = (typeof errorMsg === 'string' ? errorMsg : '').toLowerCase();
    
    if (d.includes('cloudflare') || d.includes('just a moment') || d.includes('cf-chl-bypass') || d.includes('attention required') || e.includes('cloudflare')) return true;
    if (d.includes('incapsula') || d.includes('imperva')) return true;
    if (d.includes('reference error') || d.includes('access denied') || e.includes('econnreset') || e.includes('econnrefused')) return true;
    
    return false;
};

// Strategy 1: Axios Basic
const fetchAxios = async (url, config, isStealth = false) => {
    const headers = { ...config.headers };
    if (isStealth) {
        headers['User-Agent'] = getRandomUA();
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
        headers['Sec-Ch-Ua'] = '"Not/A)Brand";v="8", "Chromium";v="126"';
        headers['Sec-Ch-Ua-Mobile'] = '?0';
        headers['Sec-Ch-Ua-Platform'] = '"Windows"';
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = 'none';
        headers['Sec-Fetch-User'] = '?1';
        headers['Upgrade-Insecure-Requests'] = '1';
    } else {
        headers['User-Agent'] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36";
    }

    try {
        const response = await axios({
            url,
            method: config.method || 'GET',
            headers,
            params: config.params || {},
            data: config.data || null,
            timeout: 25000,
        });
        
        if (isBlocked(response.status, response.data)) {
            let retryAfter = parseInt(response.headers['retry-after']);
            throw { isBlock: true, retryAfter, message: 'Blocked by Anti-Bot (Status OK but content indicates block)' };
        }
        
        return { data: response.data, source: isStealth ? 'axios-stealth' : 'axios', responseUrl: response.request?.res?.responseUrl || url };
    } catch (error) {
        const status = error.response?.status;
        if (status === 404) throw new ScraperError(ErrorTypes.NOT_FOUND, 'Page not found');
        if (status === 410) throw new ScraperError('410', 'Page gone');
        
        if (error.isBlock || isBlocked(status, error.response?.data, error.message)) {
            let retryAfter = error.retryAfter || parseInt(error.response?.headers?.['retry-after']);
            throw { isBlock: true, retryAfter, message: `Anti-Bot block detected: ${error.message}` };
        }
        
        throw new ScraperError(ErrorTypes.NETWORK_ERROR, error.message);
    }
};

const fetchPlaywright = async (url, stealthMode = false, slowNav = false) => {
    let browser = null;
    let context = null;
    let page = null;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
        
        context = await browser.newContext({
            userAgent: stealthMode ? getRandomUA() : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            viewport: stealthMode ? { width: 1920, height: 1080 } : undefined,
            locale: stealthMode ? 'en-US' : undefined,
            timezoneId: stealthMode ? 'America/New_York' : undefined,
            hasTouch: false,
            isMobile: false,
            bypassCSP: true
        });

        if (stealthMode) {
             await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
             });
        }

        page = await context.newPage();
        
        if (slowNav) {
            await sleep(2000 + Math.random() * 2000); // Human delay
        }

        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        
        const status = response ? response.status() : 200;
        let content = await page.content();
        
        if (isBlocked(status, content)) {
            // Wait for CF challenge
            console.log(`[Playwright] Cloudflare/Block detected on ${url}. Waiting for challenge resolution...`);
            try {
                await page.waitForTimeout(10000); 
                content = await page.content();
                if (isBlocked(status, content)) {
                    throw { isBlock: true, message: 'Challenge failed to resolve' };
                }
            } catch (e) {
                throw { isBlock: true, message: 'Challenge failed to resolve' };
            }
        }
        
        return { data: content, source: stealthMode ? (slowNav ? 'playwright-fingerprint-slow' : 'playwright-stealth') : 'playwright', responseUrl: url };
    } catch (error) {
        if (error.isBlock) throw error;
        if (error.message.includes('Target page, context or browser has been closed') || error.name === 'TargetClosedError') {
             throw new ScraperError(ErrorTypes.UNKNOWN, `Browser lifecycle error: ${error.message}`);
        }
        throw new ScraperError(ErrorTypes.UNKNOWN, `Playwright failed: ${error.message}`);
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
};

const fetchPuppeteer = async (url) => {
    let browser = null;
    let page = null;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        page = await browser.newPage();
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
        const content = await page.content();
        const status = response ? response.status() : 200;
        
        if (isBlocked(status, content)) {
            throw { isBlock: true, message: 'Blocked by Anti-bot' };
        }
        
        return { data: content, source: 'puppeteer-stealth', responseUrl: url };
    } catch (error) {
        if (error.isBlock) throw error;
        throw new ScraperError(ErrorTypes.UNKNOWN, `Puppeteer failed: ${error.message}`);
    } finally {
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
};

const executeScrapeRequest = async (url, config = {}) => {
  const timings = { total: 0 };
  const trail = [];
  let globalStart = Date.now();
  
  const strategies = [
      { name: 'Axios', fn: () => fetchAxios(url, config, false) },
      { name: 'Axios Stealth', fn: () => fetchAxios(url, config, true) },
      { name: 'Playwright', fn: () => fetchPlaywright(url, false, false) },
      { name: 'Playwright Stealth', fn: () => fetchPlaywright(url, true, false) },
      { name: 'Puppeteer Stealth', fn: () => fetchPuppeteer(url) },
      { name: 'Playwright Fingerprint+Delay', fn: () => fetchPlaywright(url, true, true) }
  ];

  for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      let start = Date.now();
      try {
          if (i > 1) {
              await sleep(1500 + Math.random() * 2000);
          }

          console.log(`[RetryChain] Attempting strategy ${i+1}/${strategies.length}: ${strategy.name} for ${url}`);
          const res = await strategy.fn();
          
          let duration = Date.now() - start;
          timings[strategy.name] = duration;
          timings.total = Date.now() - globalStart;
          
          trail.push({ stage: `Strategy: ${strategy.name}`, severity: "SUCCESS", message: `Fetched successfully`, durationMs: duration });
          res.timings = timings;
          res.trail = trail;
          return res;
          
      } catch (error) {
          let duration = Date.now() - start;
          timings[strategy.name] = duration;
          
          if (error instanceof ScraperError && ['404', '410'].includes(error.type)) {
              trail.push({ stage: `Strategy: ${strategy.name}`, severity: "ERROR", message: `Fatal error: ${error.message}`, durationMs: duration });
              error.trail = trail;
              error.timings = timings;
              throw error;
          }
          
          trail.push({ stage: `Strategy: ${strategy.name}`, severity: "WARN", message: `Failed: ${error.message}`, durationMs: duration });
          
          if (error.isBlock) {
             console.log(`[RetryChain] Anti-Bot block detected using ${strategy.name} on ${url}.`);
             if (error.retryAfter) {
                 const waitMs = Math.min(error.retryAfter * 1000, 30000); // Cap at 30s
                 console.log(`[RetryChain] Respecting Retry-After: waiting ${waitMs}ms`);
                 await sleep(waitMs);
             }
          }
      }
  }
  
  timings.total = Date.now() - globalStart;
  const finalErr = new ScraperError(ErrorTypes.BLOCKED, 'All scraping strategies failed (Anti-Bot block or timeout).');
  finalErr.timings = timings;
  finalErr.trail = trail;
  throw finalErr;
};

module.exports = { executeScrapeRequest };
