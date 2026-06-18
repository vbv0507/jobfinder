// dashboard.js - Dashboard page logic

// Pick an emoji icon based on company name (purely cosmetic).
function getCompanyIcon(name) {
    const icons = {
        Visa: '💳',
        LG: '📺',
        Adobe: '🎨',
    };
    return icons[name] || '🏢';
}

// Render the "Currently Scraping From" highlight grid using live data.
function renderScrapingHighlight(companies) {
    const grid = document.getElementById('scraping-grid');
    if (!grid) return;

    const active = companies.filter(c => c.active);

    if (active.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b;">No active companies</div>';
        return;
    }

    grid.innerHTML = active.map(company => `
        <div class="scraped-card">
            <div class="scraped-logo">${getCompanyIcon(company.name)}</div>
            <div class="scraped-name">${company.name}</div>
            <div class="scraped-category">${company.category || ''} Company</div>
            <div class="scraped-status">🟢 Active</div>
        </div>
    `).join('');
}

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

async function loadCompanyJobs() {
    try {
        const response = await apiCall('/jobs/complete');
        const jobs = response.jobs || {};

        const container = document.getElementById('company-jobs-content');
        const companyNames = Object.keys(jobs);

        if (companyNames.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">No jobs found yet. Run a job search to get started!</div>';
            return;
        }

        let html = '';
        companyNames.forEach(company => {
            const sections = jobs[company];
            const matchedCount = sections.matched?.length || 0;
            const rawCount = sections.raw?.length || 0;
            const total = matchedCount + rawCount;

            html += `
                <div class="company-section">
                    <h3 style="margin-bottom: 1rem; color: #0f172a; display: flex; align-items: center; gap: 0.5rem;">
                        ${getCompanyIcon(company)}
                        <span>${company}</span>
                        <span class="badge" style="margin-left: 0.5rem;">${total} jobs</span>
                    </h3>

                    ${matchedCount > 0 ? `
                        <div class="subsection matched-section" style="margin-bottom: 1rem;">
                            <h4 style="color: #059669; margin-bottom: 0.75rem;">✅ Matched Jobs (${matchedCount})</h4>
                            <div class="jobs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
                                ${sections.matched.map(job => `
                                    <div class="job-card matched" style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 0.75rem;">
                                        <div style="font-weight: 600; color: #0f172a; margin-bottom: 0.5rem;">${job.role}</div>
                                        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.3rem;">📍 ${job.location}</div>
                                        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.3rem;">🎯 Match: ${job.roleMatch}</div>
                                        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.75rem;">⭐ Score: ${job.score}</div>
                                        <a href="${job.applyLink}" target="_blank" class="apply-btn" style="display: inline-block; background: #059669; color: white; padding: 0.4rem 1rem; border-radius: 0.5rem; text-decoration: none; font-size: 0.85rem;">Apply →</a>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${rawCount > 0 ? `
                        <div class="subsection raw-section">
                            <h4 style="color: #64748b; margin-bottom: 0.75rem;">📋 Other Opportunities (${rawCount})</h4>
                            <div class="jobs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
                                ${sections.raw.map(job => `
                                    <div class="job-card raw" style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 1rem; border-radius: 0.75rem;">
                                        <div style="font-weight: 600; color: #0f172a; margin-bottom: 0.5rem;">${job.title}</div>
                                        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.3rem;">📍 ${job.location}</div>
                                        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.3rem;">💼 ${job.employmentType}</div>
                                        ${job.postedAt ? `<div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem;">📅 ${new Date(job.postedAt).toLocaleDateString()}</div>` : ''}
                                        <a href="${job.applyLink}" target="_blank" class="apply-btn" style="display: inline-block; background: #3b82f6; color: white; padding: 0.4rem 1rem; border-radius: 0.5rem; text-decoration: none; font-size: 0.85rem;">Apply →</a>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
            `;
        });

        container.innerHTML = html;
    } catch (error) {
        document.getElementById('company-jobs-content').innerHTML = '<p style="color: #ef4444; text-align: center;">Failed to load jobs</p>';
    }
}

async function runJobSearch(event) {
    try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '⏳ Searching...';
        
        const response = await apiCall('/jobs/run', 'POST');
        showAlert('✅ Job search completed! Found new opportunities.', 'success');
        
        // Reload stats, logs, and company jobs
        setTimeout(() => {
            loadStats();
            loadLogs();
            loadCompanyJobs();
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
                loadCompanyJobs();
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
document.addEventListener('DOMContentLoaded', async () => {
    // Load companies for scraping highlight
    try {
        const companiesResponse = await apiCall('/companies');
        renderScrapingHighlight(companiesResponse.companies || []);
    } catch (e) {
        // silently fail for scraping grid
    }

    loadStats();
    loadLogs();
    loadCompanyJobs();
});