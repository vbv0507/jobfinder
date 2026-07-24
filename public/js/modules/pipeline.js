let pollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchPipelineData();
    pollingInterval = setInterval(fetchPipelineData, 1000);
});

async function fetchPipelineData() {
    try {
        const [liveRes] = await Promise.all([
            fetch('/api/system/live').catch(() => null)
        ]);

        if (liveRes && liveRes.ok) {
            const live = await liveRes.json();
            updatePipelineDOM(live.pipeline);
        }
    } catch (e) {
        console.error("Failed to fetch pipeline data:", e);
    }
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

    if (state.running || state.currentStage === "FINISHED" || state.currentStage === "FAILED" || state.currentStage === "CANCELLED") {
        statusText.innerText = `Status: ${state.statusText}`;
        statusIndicator.className = state.running 
            ? 'w-3 h-3 rounded-full bg-warning animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]' 
            : (state.currentStage === "FINISHED" ? 'w-3 h-3 rounded-full bg-success' : 'w-3 h-3 rounded-full bg-error');
        
        elapsedTime.innerText = (state.elapsedTime / 1000).toFixed(0) + 's';
        if (remainingTime) {
            let eta = 0;
            if (state.companyIndex > 0) {
                eta = (state.elapsedTime / state.companyIndex) * (state.totalCompanies - state.companyIndex);
            }
            remainingTime.innerText = (eta / 1000).toFixed(0) + 's';
        }
        
        progressBar.style.width = state.progress;
        progressPercent.innerText = state.progress;
        progressText.innerText = `Company ${state.companyIndex} of ${state.totalCompanies}`;
        
        currentCompany.innerText = state.currentCompany || 'None';
        if (state.currentATS) {
            currentAts.innerText = state.currentATS;
            currentAts.classList.remove('hidden');
        } else {
            currentAts.classList.add('hidden');
        }
        
        if (currentUrl) currentUrl.innerText = state.currentURL || 'N/A';
        if (jobsFound) jobsFound.innerText = state.jobsFound || '0';
        if (jobsSaved) jobsSaved.innerText = state.jobsSaved || '0';
        if (matchedJobs) matchedJobs.innerText = state.matchedJobs || '0';
        if (retryCount) retryCount.innerText = state.retryCount || '0';
        if (currentModel) currentModel.innerText = state.currentModel || 'N/A';
        
        currentStage.innerText = state.currentStage || 'IDLE';
        currentStage.className = 'text-sm font-semibold text-warning truncate';
    } else {
        statusText.innerText = 'Status: Idle';
        statusIndicator.className = 'w-3 h-3 rounded-full bg-border shadow-[0_0_8px_rgba(39,39,42,0.6)]';
        elapsedTime.innerText = '0s';
        if (remainingTime) remainingTime.innerText = '0s';
        progressBar.style.width = '0%';
        progressPercent.innerText = '0%';
        progressText.innerText = 'Company 0 of 0';
        
        currentCompany.innerText = 'None';
        currentAts.classList.add('hidden');
        if (currentUrl) currentUrl.innerText = 'N/A';
        if (jobsFound) jobsFound.innerText = '0';
        if (jobsSaved) jobsSaved.innerText = '0';
        if (matchedJobs) matchedJobs.innerText = '0';
        if (retryCount) retryCount.innerText = '0';
        if (currentModel) currentModel.innerText = 'N/A';
        currentStage.innerText = 'Idle';
        currentStage.className = 'text-sm font-semibold text-textMuted truncate';
    }
    
    updateTimelineDOM(state.timeline);
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
    
    let html = '';
    logs.forEach(log => {
        let color = '#8b949e'; // default gray
        if (log.level === 'INFO') color = '#58a6ff';
        if (log.level === 'SUCCESS') color = '#238636';
        if (log.level === 'WARNING') color = '#d29922';
        if (log.level === 'ERROR') color = '#f85149';
        
        const timeStr = new Date(log.time).toLocaleTimeString([], { hour12: false });
        html += `<div style="color: ${color};" class="mb-1"><span class="text-[#8b949e]">[${timeStr}]</span> [${log.level}] ${log.message}</div>`;
    });
    
    // Only update if it changed, to allow scrolling without jumping
    if (container.dataset.lastLogTime !== (logs[0] && logs[0].time)) {
        container.innerHTML = html;
        if (logs[0]) container.dataset.lastLogTime = logs[0].time;
    }
}
