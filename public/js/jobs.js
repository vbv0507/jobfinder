// jobs.js - Jobs page logic

let currentJobType = 'matched';

async function loadJobs(type) {
    const endpoint = type === 'matched' ? '/jobs/matched' : '/jobs/raw';
    
    try {
        const response = await apiCall(endpoint);
        const jobs = response.jobs || [];
        
        const jobsContent = document.getElementById('jobs-content');
        
        if (jobs.length === 0) {
            jobsContent.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 2rem;">No jobs found</div>';
            return;
        }
        
        const jobsHTML = jobs.map(job => `
            <div class="job-card">
                <div class="job-title">${job.title || job.role || 'Job Title'}</div>
                <div class="job-company">${typeof job.company === 'string' ? job.company : (job.company?.name || 'Company')}</div>
                <div class="job-meta">
                    <span>📍 ${job.location || 'Location not specified'}</span>
                </div>
                <div class="job-meta">
                    <span>🕒 ${job.employmentType || 'Full-Time'}</span>
                </div>
                ${job.score ? `<div class="job-badge">Match: ${job.score}%</div>` : ''}
                <div class="job-description">${formatDescription(job.description || job.reason)}</div>
                <a href="${job.applyLink || job.url || '#'}" target="_blank" class="job-link">View Job →</a>
            </div>
        `).join('');
        
        jobsContent.innerHTML = jobsHTML;
    } catch (error) {
        document.getElementById('jobs-content').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444;">Failed to load jobs</div>';
    }
}

function showJobs(type) {
    currentJobType = type;
    
    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach((btn, index) => {
        btn.classList.remove('active');
        if ((type === 'matched' && index === 0) || (type === 'raw' && index === 1)) {
            btn.classList.add('active');
        }
    });
    
    // Load jobs
    loadJobs(type);
}

// Load jobs on page load
document.addEventListener('DOMContentLoaded', () => {
    loadJobs('matched');
});
