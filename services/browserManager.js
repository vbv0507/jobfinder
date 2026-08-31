const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

try {
    puppeteer.use(StealthPlugin());
} catch (_) {}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

let cachedExecutablePath = null;

/**
 * Ensures Chromium browser binary exists in local project cache (.cache/puppeteer)
 * and returns the exact executable path. If missing on cloud startup, installs it on-the-fly.
 */
async function getOrInstallBrowserPath() {
    if (cachedExecutablePath && fs.existsSync(cachedExecutablePath)) {
        return cachedExecutablePath;
    }

    try {
        const { install, computeExecutablePath, Browser, detectBrowserPlatform } = require('@puppeteer/browsers');
        const platform = detectBrowserPlatform();
        const buildId = '131.0.6778.85'; // Stable production Chromium release

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

        console.log(`[BrowserManager] Chrome binary not found in ${CACHE_DIR}. Installing ${buildId} on-the-fly...`);
        const installed = await install({
            browser: Browser.CHROME,
            buildId: buildId,
            cacheDir: CACHE_DIR,
            platform: platform
        });

        console.log(`[BrowserManager] Successfully installed Chrome to: ${installed.executablePath}`);
        cachedExecutablePath = installed.executablePath;
        return installed.executablePath;
    } catch (e) {
        console.warn(`[BrowserManager] Dynamic browser installation notice: ${e.message}`);
        // Let puppeteer attempt its default resolution
        return undefined;
    }
}

/**
 * Launches a cloud-safe, stealth-enabled Puppeteer browser instance.
 */
async function launchBrowser(customArgs = []) {
    const executablePath = await getOrInstallBrowserPath();

    const defaultArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        ...customArgs
    ];

    const launchOptions = {
        headless: 'new',
        args: defaultArgs
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
