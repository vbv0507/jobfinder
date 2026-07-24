const { AsyncLocalStorage } = require('async_hooks');
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const asyncLocalStorage = new AsyncLocalStorage();

const formatLog = (level, args) => {
    const store = asyncLocalStorage.getStore() || {};
    const timestamp = new Date().toISOString();
    const pipelineId = store.pipelineId || "SYSTEM";
    const provider = store.provider || "N/A";
    const company = store.company || "N/A";
    const jobUrl = store.jobUrl || "N/A";
    const stage = store.stage || "N/A";
    const duration = store.durationMs !== undefined ? `${store.durationMs}ms` : "N/A";

    const prefix = `[${timestamp}] [${pipelineId}] [${provider}] [${company}] [${jobUrl}] [${stage}] [${duration}] [${level}]`;
    
    // We join the arguments so that objects are printed correctly
    const message = args.map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        return typeof arg === 'object' ? JSON.stringify(arg) : arg;
    }).join(' ');
    
    return `${prefix} ${message}`;
};

console.log = (...args) => {
    originalConsoleLog(formatLog('INFO', args));
};

console.error = (...args) => {
    originalConsoleError(formatLog('ERROR', args));
};

console.warn = (...args) => {
    originalConsoleWarn(formatLog('WARN', args));
};

const withLogContext = (context, callback) => {
    const parentStore = asyncLocalStorage.getStore() || {};
    return asyncLocalStorage.run({ ...parentStore, ...context }, callback);
};

module.exports = { withLogContext };
