const CacheManager = require("./cacheManager");
const { invalidateAnalyticsCache } = require("./analyticsService");

const invalidateCompanyViews = () => {
    CacheManager.invalidate();
    invalidateAnalyticsCache();
};

const emitCompanySnapshot = (errorMessage) => {
    const socketService = require("./socketService");
    socketService.emitCompanySnapshot().catch((error) => {
        console.error(errorMessage, error.message);
    });
};

const refreshCompanyViews = (errorMessage) => {
    invalidateCompanyViews();
    emitCompanySnapshot(errorMessage);
};

module.exports = {
    emitCompanySnapshot,
    invalidateCompanyViews,
    refreshCompanyViews,
};
