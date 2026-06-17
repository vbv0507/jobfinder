// dashboard.js - Dashboard page logic

async function loadStats() {
    try {
        const [rawResponse, matchedResponse] = await Promise.all([
            apiCall('/jobs/raw'),
            apiCall('/jobs/matched'),
        ]);
        const totalJobs = Number(rawResponse.count || 0);
        const matchedJobs = Number(matchedResponse.count || 0);
        
        const statsContent = document.getElementById('stats-content');
        statsContent.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${totalJobs}</div>
                    <div class="stat-label">Total Jobs</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${matchedJobs}</div>
                    <div class="stat-label">Matched</div>
                </div>
            </div>
        `;
    } catch (error) {
        document.getElementById('stats-content').innerHTML = '<p style="color: #ef4444;">Failed to load stats</p>';
    }
}

async function loadLogs() {
    try {
        const response = await apiCall('/jobs/logs');
        const logs = response.logs || [];
        
        const logsContent = document.getElementById('logs-content');
        
        if (logs.length === 0) {
            logsContent.innerHTML = '<p style="color: #64748b; text-align: center;">📭 No recent activity yet</p>';
            return;
        }
        
        const logsList = logs.slice(0, 3).map(log => `
            <div style="margin-bottom: 1.2rem; padding-bottom: 1.2rem; border-bottom: 1px solid #e2e8f0;">
                <div style="font-weight: 600; color: #1e293b; font-size: 0.95rem;">${formatDate(log.completedAt || log.startedAt || log.createdAt || log.runDate)}</div>
                <div style="color: #64748b; font-size: 0.9rem; margin-top: 0.3rem;">
                    🔍 ${log.jobsFound || 0} jobs found · ✅ ${log.jobsMatched || 0} matched
                </div>
                <div style="color: #64748b; font-size: 0.85rem; margin-top: 0.2rem;">
                    Status: ${log.status || 'Success'}
                </div>
            </div>
        `).join('');
        
        logsContent.innerHTML = logsList;
    } catch (error) {
        document.getElementById('logs-content').innerHTML = '<p style="color: #ef4444;">Failed to load activity</p>';
    }
}

async function runJobSearch(event) {
    try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '⏳ Searching...';
        
        const response = await apiCall('/jobs/run', 'POST');
        showAlert('✅ Job search completed! Found new opportunities.', 'success');
        
        // Reload stats and logs
        setTimeout(() => {
            loadStats();
            loadLogs();
        }, 1000);
        
        btn.disabled = false;
        btn.textContent = '🔍 Run Job Search';
    } catch (error) {
        event.target.disabled = false;
        event.target.textContent = '🔍 Run Job Search';
    }
}

async function deleteRawJobs(event) {
    try {
        if (!confirm('Are you sure? This will delete all raw jobs. This action cannot be undone.')) {
            return;
        }
        
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '⏳ Deleting...';
        
        const response = await fetch('/api/jobs/raw', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert(`✅ Deleted ${data.deletedCount || 0} raw jobs`, 'success');
            setTimeout(() => {
                loadStats();
            }, 1000);
        } else {
            showAlert('❌ Failed to delete jobs', 'error');
        }
        
        btn.disabled = false;
        btn.textContent = '🗑️ Clear Jobs';
    } catch (error) {
        event.target.disabled = false;
        event.target.textContent = '🗑️ Clear Jobs';
        showAlert('❌ Error: ' + error.message, 'error');
    }
}

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadLogs();
});
