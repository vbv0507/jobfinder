function getCompanyIcon(name) {
    const icons = {
        CommerceIQ: "CIQ",
        Visa: "V",
        LG: "LG",
        Adobe: "A",
        Paytm: "P",
        PhonePe: "Ph",
        Groww: "G",
    };
    return icons[name] || "Co";
}

function renderScrapingHighlight(companies) {
    const grid = document.getElementById("scraping-grid");
    if (!grid) return;

    const active = companies.filter((company) => company.active);

    if (active.length === 0) {
        grid.innerHTML = '<div class="empty-inline">No active companies</div>';
        return;
    }

    grid.innerHTML = active.map((company) => `
        <article class="scraped-card">
            <div class="scraped-logo">${getCompanyIcon(company.name)}</div>
            <div>
                <div class="scraped-name">${company.name}</div>
                <div class="scraped-category">${company.category || "Unknown"} Company</div>
            </div>
            <div class="scraped-status">Active</div>
        </article>
    `).join("");
}

async function loadStats() {
    try {
        const matchedResponse = await apiCall("/jobs/matched");
        const matchedJobs = Number(matchedResponse.count || 0);

        document.getElementById("stats-content").innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${matchedJobs}</div>
                    <div class="stat-label">Matched Jobs</div>
                </div>
            </div>
        `;
    } catch (error) {
        document.getElementById("stats-content").innerHTML = '<p class="error-text">Failed to load stats</p>';
    }
}

async function loadLogs() {
    try {
        const response = await apiCall("/jobs/logs");
        const logs = response.logs || [];
        const logsContent = document.getElementById("logs-content");

        if (logs.length === 0) {
            logsContent.innerHTML = '<p class="muted">No recent activity yet.</p>';
            return;
        }

        logsContent.innerHTML = logs.slice(0, 4).map((log) => `
            <div class="log-item">
                <div class="log-title">${formatDate(log.completedAt || log.startedAt || log.createdAt || log.runDate)}</div>
                <div class="log-meta">${log.jobsFound || 0} found - ${log.jobsMatched || 0} matched - ${log.status || "Success"}</div>
            </div>
        `).join("");
    } catch (error) {
        document.getElementById("logs-content").innerHTML = '<p class="error-text">Failed to load activity</p>';
    }
}

function renderJobCard(job) {
    return `
        <article class="job-card matched">
            <div class="job-header">
                <h3>${job.role}</h3>
                <span class="score">${job.score}</span>
            </div>
            <div class="job-details">
                <p><strong>Location:</strong> ${job.location || "Not specified"}</p>
                <p><strong>Match:</strong> ${job.roleMatch || "Profile aligned"}</p>
            </div>
            <div class="job-footer">
                <small>AI selected</small>
                <a href="${job.applyLink}" target="_blank" class="apply-btn">Apply</a>
            </div>
        </article>
    `;
}

async function loadCompanyJobs() {
    try {
        const response = await apiCall("/jobs/complete");
        const jobs = response.jobs || {};
        const container = document.getElementById("company-jobs-content");
        const companyNames = Object.keys(jobs);

        if (companyNames.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No matched jobs found yet. Run a search to check the latest fresher-friendly roles.</p></div>';
            return;
        }

        container.innerHTML = companyNames.map((company) => {
            const sections = jobs[company];
            const matchedCount = sections.matched?.length || 0;

            return `
                <section class="company-section">
                    <div class="company-name">
                        <span class="badge">${company}</span>
                        <small>${matchedCount} matched jobs</small>
                    </div>
                    ${matchedCount > 0 ? `
                        <div class="subsection matched-section">
                            <h3 class="subsection-title">Matched Jobs (${matchedCount})</h3>
                            <div class="jobs-grid">${sections.matched.map((job) => renderJobCard(job)).join("")}</div>
                        </div>
                    ` : ""}
                </section>
            `;
        }).join("");
    } catch (error) {
        document.getElementById("company-jobs-content").innerHTML = '<p class="error-text">Failed to load jobs</p>';
    }
}

async function runJobSearch(event) {
    const btn = event.target;

    try {
        btn.disabled = true;
        btn.textContent = "Searching...";

        await apiCall("/jobs/run", "POST");
        showAlert("Job search completed. Latest jobs are loading.", "success");

        setTimeout(() => {
            loadStats();
            loadLogs();
            loadCompanyJobs();
        }, 1000);
    } finally {
        btn.disabled = false;
        btn.textContent = "Run Job Search";
    }
}

async function deleteRawJobs(event) {
    if (!confirm("Delete all raw jobs? Matched jobs are not removed by this action.")) {
        return;
    }

    const btn = event.target;

    try {
        btn.disabled = true;
        btn.textContent = "Deleting...";

        const response = await fetch("/api/jobs/raw", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
        });
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Failed to delete jobs");
        }

        showAlert(`Deleted ${data.deletedCount || 0} raw jobs`, "success");
        setTimeout(() => {
            loadStats();
            loadCompanyJobs();
        }, 1000);
    } catch (error) {
        showAlert(`Error: ${error.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Clear Raw Jobs";
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const companiesResponse = await apiCall("/companies");
        renderScrapingHighlight(companiesResponse.companies || []);
    } catch (e) {
        // The rest of the dashboard can still load.
    }

    loadStats();
    loadLogs();
    loadCompanyJobs();
});
