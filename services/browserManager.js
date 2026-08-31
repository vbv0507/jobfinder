const path = require('path');
const fs = require('fs');
const { addExtra } = require('puppeteer-extra');
const puppeteerCore = addExtra(require('puppeteer-core'));
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

try {
    puppeteerCore.use(StealthPlugin());
} catch (_) {}

const isLinux = process.platform === 'linux';

/**
 * Resolves Chrome executable path for the current OS.
 * On Linux (Azure App Service / AWS / Docker): Dynamically imports @sparticuz/chromium (ESM).
 * On Windows / macOS: Uses installed Chrome, Edge, or project cache.
 */
async function getExecutablePath() {
    if (isLinux) {
        try {
            const chromiumModule = await import('@sparticuz/chromium');
            const chromium = chromiumModule.default || chromiumModule;
            const execPath = await chromium.executablePath();
            if (execPath) {
                console.log(`[BrowserManager] Using @sparticuz/chromium on Linux: ${execPath}`);
                return execPath;
            }
        } catch (e) {
            console.error('[BrowserManager] @sparticuz/chromium path error:', e.message);
        }
    }

    // Windows / macOS Local Chrome locations
    const candidatePaths = [
        // Windows Chrome
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        // Windows Edge fallback
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        // macOS Chrome
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];

    for (const p of candidatePaths) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }

    // Try @puppeteer/browsers cache if available
    try {
        const { computeExecutablePath, Browser, detectBrowserPlatform } = require('@puppeteer/browsers');
        const platform = detectBrowserPlatform();
        const cacheDir = path.join(process.cwd(), '.cache', 'puppeteer');
        const localPath = computeExecutablePath({
            browser: Browser.CHROME,
            buildId: '131.0.6778.85',
            cacheDir: cacheDir,
            platform: platform
        });
        if (fs.existsSync(localPath)) return localPath;
    } catch (_) {}

    return undefined;
}

/**
 * Launches a cloud-safe, stealth-enabled Puppeteer browser instance using puppeteer-core.
 */
async function launchBrowser(customArgs = []) {
    const executablePath = await getExecutablePath();
    let launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        ...customArgs
    ];
    let isHeadless = true;

    if (isLinux) {
        try {
            const chromiumModule = await import('@sparticuz/chromium');
            const chromium = chromiumModule.default || chromiumModule;
            launchArgs = [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                ...customArgs
            ];
            isHeadless = chromium.headless;
        } catch (_) {}
    }

    const launchOptions = {
        headless: isHeadless,
        args: launchArgs
    };

    if (executablePath) {
        launchOptions.executablePath = executablePath;
    }

    return await puppeteerCore.launch(launchOptions);
}

module.exports = {
    getExecutablePath,
    launchBrowser
};
