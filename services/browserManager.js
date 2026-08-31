const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

try {
    puppeteer.use(StealthPlugin());
} catch (_) {}

const isLinux = process.platform === 'linux';
const CACHE_DIR = path.join(process.cwd(), '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

let cachedExecutablePath = null;

/**
 * Ensures Chromium browser binary exists in local project cache (.cache/puppeteer)
 * for Windows / macOS environments.
 */
async function getOrInstallBrowserPath() {
    if (cachedExecutablePath && fs.existsSync(cachedExecutablePath)) {
        return cachedExecutablePath;
    }

    try {
        const { install, computeExecutablePath, Browser, detectBrowserPlatform } = require('@puppeteer/browsers');
        const platform = detectBrowserPlatform();
        const buildId = '131.0.6778.85';

        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }

        const expectedPath = computeExecutablePath({
            browser: Browser.CHROME,
            buildId: buildId,
            cacheDir: CACHE_DIR,
            platform: platform
        });

        if (fs.existsSync(expectedPath)) {
            cachedExecutablePath = expectedPath;
            return expectedPath;
        }

        console.log(`[BrowserManager] Installing Chrome ${buildId} into ${CACHE_DIR}...`);
        const installed = await install({
            browser: Browser.CHROME,
            buildId: buildId,
            cacheDir: CACHE_DIR,
            platform: platform
        });

        cachedExecutablePath = installed.executablePath;
        return installed.executablePath;
    } catch (e) {
        console.warn(`[BrowserManager] Dynamic browser installation notice: ${e.message}`);
        return undefined;
    }
}

/**
 * Launches a cloud-safe, stealth-enabled Puppeteer browser instance.
 * On Linux (Azure App Service / AWS / Docker), uses @sparticuz/chromium which bundles all required .so shared libraries.
 * On Windows / macOS (local dev), uses local Chrome or @puppeteer/browsers.
 */
async function launchBrowser(customArgs = []) {
    let executablePath = null;
    let launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        ...customArgs
    ];
    let isHeadless = 'new';

    if (isLinux) {
        try {
            const chromium = require('@sparticuz/chromium');
            executablePath = await chromium.executablePath();
            launchArgs = [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                ...customArgs
            ];
            isHeadless = chromium.headless;
        } catch (linuxErr) {
            console.warn("[BrowserManager] @sparticuz/chromium resolution failed, using fallback:", linuxErr.message);
        }
    }

    if (!executablePath && !isLinux) {
        executablePath = await getOrInstallBrowserPath();
    }

    const launchOptions = {
        headless: isHeadless,
        args: launchArgs
    };

    if (executablePath) {
        launchOptions.executablePath = executablePath;
    }

    return await puppeteer.launch(launchOptions);
}

module.exports = {
    getOrInstallBrowserPath,
    launchBrowser
};
