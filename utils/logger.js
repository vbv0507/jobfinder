const { AsyncLocalStorage } = require('async_hooks');
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const asyncLocalStorage = new AsyncLocalStorage();

const formatLog = (level, args) => {
    const store = asyncLocalStorage.getStore() || {};
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const timestamp = formatter.format(new Date()).replace(',', '') + ' IST';
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

const broadcastLog = (level, message) => {
    try {
        const socketService = require('../services/socketService');
        socketService.emitLogs({
            time: Date.now(),
            level,
            message
        });
    } catch (error) {}
};

console.log = (...args) => {
    const message = formatLog('INFO', args);
    originalConsoleLog(message);
    broadcastLog('INFO', message);
};

console.error = (...args) => {
    const message = formatLog('ERROR', args);
    originalConsoleError(message);
    broadcastLog('ERROR', message);
};

console.warn = (...args) => {
    const message = formatLog('WARNING', args);
    originalConsoleWarn(message);
    broadcastLog('WARNING', message);
};

const withLogContext = (context, callback) => {
    const parentStore = asyncLocalStorage.getStore() || {};
    return asyncLocalStorage.run({ ...parentStore, ...context }, callback);
};

module.exports = { withLogContext };
