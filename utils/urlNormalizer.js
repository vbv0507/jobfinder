function normalizeJobUrl(urlStr) {
    if (!urlStr) return "";
    try {
        const url = new URL(urlStr);
        url.hostname = url.hostname.toLowerCase();
        
        // Remove tracking params
        url.searchParams.delete("utm_source");
        url.searchParams.delete("utm_medium");
        url.searchParams.delete("utm_campaign");
        url.searchParams.delete("fbclid");
        url.searchParams.delete("gclid");
        
        url.hash = "";
        
        let pathname = url.pathname.replace(/\/+/g, "/");
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        url.pathname = pathname;
        
        const finalUrl = url.toString();
        // Remove trailing slash if it's just the root and nothing else, although URL handles it.
        return finalUrl.endsWith('/') && url.pathname === '/' && !url.search ? finalUrl.slice(0, -1) : finalUrl;
    } catch (e) {
        return urlStr;
    }
}

module.exports = { normalizeJobUrl };
