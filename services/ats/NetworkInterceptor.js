const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

class NetworkInterceptor {
  static sanitizeHeaders(rawHeaders) {
    const headers = { ...rawHeaders };
    const forbiddenHeaders = [
      ':authority', ':method', ':path', ':scheme',
      'host', 'connection', 'content-length', 'content-encoding', 
      'transfer-encoding', 'upgrade', 'keep-alive',
      'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
      'accept-encoding', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'
    ];
    
    Object.keys(headers).forEach(key => {
        const k = key.toLowerCase();
        if (forbiddenHeaders.includes(k) || k.startsWith('proxy-') || k.startsWith('cf-') || k.startsWith('x-forwarded-')) {
            delete headers[key];
        }
    });
    return headers;
  }

  /**
   * Navigates to a career URL and intercepts XHR/Fetch requests to identify the ATS API.
   * @param {string} url - The career URL to navigate to
   * @param {Array} signatures - Array of network signatures provided by Adapters
   * @returns {Object|null} The intercepted API request configuration or null
   */
  static async discoverApi(url, signatures) {
    let browser = null;
    let matchedRequest = null;
    let matchedSignature = null;
    let responseBody = null;
    const trail = [];

    try {
      trail.push({ stage: "Network Interception", severity: "INFO", message: `Launching headless browser for ${url}` });
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const context = await browser.newContext({
         userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      });
      const page = await context.newPage();
      
      page.on('response', async (response) => {
        if (matchedRequest) return; // already found one
        
        const request = response.request();
        if (['fetch', 'xhr'].includes(request.resourceType())) {
          const reqUrl = request.url();
          const status = response.status();
          console.log(`[Intercept] ${request.method()} ${reqUrl} (${status})`);
          
          if (status >= 200 && status < 400) {
             for (const sig of signatures) {
                if (sig.urlRegex && sig.urlRegex.test(reqUrl)) {
                   try {
                       const json = await response.json();
                       if (sig.validatePayload && !sig.validatePayload(json)) {
                           continue; // Signature matched URL but payload is not a job list
                       }
                       
                       matchedRequest = request;
                       matchedSignature = sig;
                       responseBody = json;
                       trail.push({ stage: "Network Interception", severity: "SUCCESS", message: `Matched API: ${reqUrl} (${sig.ats})` });
                       return;
                   } catch(e) {
                       // Not JSON or unable to parse, ignore
                   }
                }
             }
          }
        }
      });

      trail.push({ stage: "Network Interception", severity: "INFO", message: `Navigating to ${url}...` });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      
      // Force wait for 8 seconds because SPAs do multiple cascading requests
      await page.waitForTimeout(8000);

    } catch(e) {
       trail.push({ stage: "Network Interception", severity: "WARN", message: `Navigation ended with warning: ${e.message}` });
    }
    
    let result = { trail };

    if (matchedRequest) {
       try {
           const headers = await matchedRequest.allHeaders();
           
           // Strip volatile and environment-specific headers to make the template reusable
           const sanitizedHeaders = NetworkInterceptor.sanitizeHeaders(headers);
           
           let postData = null;
           try {
               if (matchedRequest.postData()) {
                   postData = matchedRequest.postDataJSON();
               }
           } catch(e) {}

           result = {
               ats: matchedSignature.ats,
               apiMethod: matchedRequest.method().toUpperCase(),
               apiUrl: matchedRequest.url(),
               apiHeaders: sanitizedHeaders,
               apiPayload: postData,
               sampleResponse: responseBody,
               trail
           };
       } catch (e) {
           trail.push({ stage: "Network Interception", severity: "ERROR", message: `Failed to extract request data: ${e.message}` });
       }
    } else {
        trail.push({ stage: "Network Interception", severity: "WARN", message: `No API endpoints matched known signatures` });
    }

    if (browser) await browser.close().catch(e => trail.push({ stage: "Network Interception", severity: "WARN", message: `Browser close warning: ${e.message}` }));
    
    return result;
  }
}

module.exports = NetworkInterceptor;
