import { createSocket } from './socketClient.js';

let socket = null;
let allLogs = [];

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
});

async function initSocket() {
    try {
        socket = await createSocket();
    } catch (error) {
        console.error(error);
        return;
    }

    socket.on('dashboard:init', (payload) => {
        if (payload.pipeline) updatePipelineDOM(payload.pipeline);
    });

    socket.on('pipeline:stopped', (pipeline) => {
        updatePipelineDOM(pipeline);
    });

    socket.on('pipeline:update', (payload) => {
        updatePipelineDOM(payload.pipeline || payload);
    });

    socket.on('logs:new', (logEntry) => {
        allLogs.unshift(logEntry);
        if (allLogs.length > 500) allLogs.pop();
        updateTimelineDOM(allLogs);
    });

    socket.on('pipeline:progress', (entry) => {
        if (entry.pipeline) updatePipelineDOM(entry.pipeline);
        allLogs.unshift({
            time: entry.timestamp,
            level: entry.status || 'INFO',
            message: entry.message || `${entry.stage || 'Progress'}${entry.companyName ? ` - ${entry.companyName}` : ''}`
        });
        if (allLogs.length > 500) allLogs.pop();
        updateTimelineDOM(allLogs);
    });

    socket.on('pipeline:error', (payload) => {
        if (payload?.pipeline) updatePipelineDOM(payload.pipeline);
        allLogs.unshift({
            time: Date.now(),
            level: 'ERROR',
            message: payload?.message || payload
        });
        updateTimelineDOM(allLogs);
    });

    socket.on('connect', () => {
        socket.emit('dashboard:refresh');
    });

    socket.emit('dashboard:refresh');
}

function updatePipelineDOM(state) {
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.getElementById('status-indicator');
    const elapsedTime = document.getElementById('elapsed-time');
    const remainingTime = document.getElementById('remaining-time');
    const progressBar = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const progressPercent = document.getElementById('progress-percent');

    const currentCompany = document.getElementById('current-company');
    const currentAts = document.getElementById('current-ats');
    const currentUrl = document.getElementById('current-url');
    const jobsFound = document.getElementById('jobs-found');
    const currentStage = document.getElementById('current-stage');

    const currentModel = document.getElementById('current-model');
    const jobsSaved = document.getElementById('jobs-saved');
    const matchedJobs = document.getElementById('matched-jobs');
    const retryCount = document.getElementById('retry-count');

    if (!statusText || !statusIndicator || !elapsedTime || !progressBar || !progressText || !progressPercent) return;

    if (state.running || ["FINISHED", "FAILED", "CANCELLED"].includes(state.currentStage)) {
        statusText.innerText = `Status: ${state.statusText}`;
        statusIndicator.className = state.running
            ? 'w-3 h-3 rounded-full bg-warning animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]'
            : (state.currentStage === "FINISHED" ? 'w-3 h-3 rounded-full bg-success' : 'w-3 h-3 rounded-full bg-error');

        elapsedTime.innerText = ((state.elapsedTime || 0) / 1000).toFixed(0) + 's';
        if (remainingTime) {
            let eta = 0;
            if (state.companyIndex > 0) {
                eta = (state.elapsedTime / state.companyIndex) * (state.totalCompanies - state.companyIndex);
            }
            remainingTime.innerText = (eta / 1000).toFixed(0) + 's';
        }

        const progress = normalizeProgress(state.progress, state.companyIndex, state.totalCompanies);
        progressBar.style.width = progress.percent;
        progressPercent.innerText = progress.label;
        progressText.innerText = `Company ${state.companyIndex || 0} of ${state.totalCompanies || 0}`;

        if (currentCompany) currentCompany.innerText = state.currentCompany || 'None';
        if (currentAts) {
            if (state.currentATS) {
                currentAts.innerText = state.currentATS;
                currentAts.classList.remove('hidden');
            } else {
                currentAts.classList.add('hidden');
            }
        }

        if (currentUrl) currentUrl.innerText = state.currentURL || 'N/A';
        if (jobsFound) jobsFound.innerText = state.jobsFound || '0';
        if (jobsSaved) jobsSaved.innerText = state.jobsSaved || '0';
        if (matchedJobs) matchedJobs.innerText = state.matchedJobs || '0';
        if (retryCount) retryCount.innerText = state.retryCount || '0';
        if (currentModel) currentModel.innerText = state.currentModel || 'N/A';

        if (currentStage) {
            currentStage.innerText = state.currentStage || 'IDLE';
            currentStage.className = 'text-sm font-semibold text-warning truncate';
        }
    } else {
        statusText.innerText = 'Status: Idle';
        statusIndicator.className = 'w-3 h-3 rounded-full bg-border shadow-[0_0_8px_rgba(39,39,42,0.6)]';
        elapsedTime.innerText = '0s';
        if (remainingTime) remainingTime.innerText = '0s';
        progressBar.style.width = '0%';
        progressPercent.innerText = '0%';
        progressText.innerText = 'Company 0 of 0';

        if (currentCompany) currentCompany.innerText = 'None';
        if (currentAts) currentAts.classList.add('hidden');
        if (currentUrl) currentUrl.innerText = 'N/A';
        if (jobsFound) jobsFound.innerText = '0';
        if (jobsSaved) jobsSaved.innerText = '0';
        if (matchedJobs) matchedJobs.innerText = '0';
        if (retryCount) retryCount.innerText = '0';
        if (currentModel) currentModel.innerText = 'N/A';
        if (currentStage) {
            currentStage.innerText = 'Idle';
            currentStage.className = 'text-sm font-semibold text-textMuted truncate';
        }
    }

    allLogs = state.logs || allLogs;
    updateTimelineDOM(allLogs);
}

function normalizeProgress(progress, index, total) {
    if (typeof progress === 'string' && progress.endsWith('%')) {
        return { percent: progress, label: progress };
    }

    if (total > 0) {
        const percent = Math.round((Number(index || 0) / Number(total)) * 100) + '%';
        return { percent, label: progress || percent };
    }

    return { percent: '0%', label: progress || '0%' };
}

function updateTimelineDOM(logs) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    if (!logs || logs.length === 0) {
        if (!container.dataset.hasLogs) {
            container.innerHTML = '<p class="p-4 text-textMuted text-center text-sm">Waiting for execution to start...</p>';
        }
        return;
    }

    container.dataset.hasLogs = "true";

    const html = logs.map(log => {
        let color = '#8b949e';
        if (log.level === 'INFO') color = '#58a6ff';
        if (log.level === 'SUCCESS') color = '#238636';
        if (log.level === 'WARNING') color = '#d29922';
        if (log.level === 'ERROR') color = '#f85149';

        const timestamp = log.time || log.timestamp;
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour12: false });
        return `<div style="color: ${color};" class="mb-1"><span class="text-[#8b949e]">[${timeStr}]</span> [${log.level || log.status || 'INFO'}] ${log.message || log.stage || ''}</div>`;
    }).join('');

    if (container.dataset.lastLogTime !== String(logs[0] && (logs[0].time || logs[0].timestamp))) {
        container.innerHTML = html;
        if (logs[0]) container.dataset.lastLogTime = logs[0].time || logs[0].timestamp;
    }
}
