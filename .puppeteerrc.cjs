const { join } = require('path');

/**
 * Configure Puppeteer to store Chromium inside the project's .cache directory.
 * This guarantees that Azure App Service and cloud CI/CD containers package
 * and preserve the Chromium binary in /home/site/wwwroot/.cache across deploys.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
