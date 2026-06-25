function getCompanyIcon(name) {
    const icons = {
        Visa: "V",
        LG: "LG",
        Adobe: "A",
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
        const [rawResponse, matchedResponse] = await Promise.all([
            apiCall("/jobs/raw"),
            apiCall("/jobs/matched"),
        ]);
        const totalJobs = Number(rawResponse.count || 0);
        const matchedJobs = Number(matchedResponse.count || 0);
        const notMatched = Math.max(totalJobs - matchedJobs, 0);

        document.getElementById("stats-content").innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${totalJobs}</div>
                    <div class="stat-label">Scraped</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${matchedJobs}</div>
                    <div class="stat-label">Matched</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${notMatched}</div>
                    <div class="stat-label">Not Matched</div>
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
                <div class="log-meta">${log.jobsFound || 0} found · ${log.jobsMatched || 0} matched · ${log.status || "Success"}</div>
            </div>
        `).join("");
    } catch (error) {
        document.getElementById("logs-content").innerHTML = '<p class="error-text">Failed to load activity</p>';
    }
}

function renderJobCard(job, type) {
    const isMatched = type === "matched";
    const title = isMatched ? job.role : job.title;
    const meta = isMatched
        ? `<p><strong>Match:</strong> ${job.roleMatch || "Profile aligned"}</p>`
        : `<p><strong>Type:</strong> ${job.employmentType || "Full-Time"}</p>`;
    const status = isMatched ? `<span class="score">${job.score}</span>` : '<span class="badge-gray">Raw</span>';

    return `
        <article class="job-card ${type}">
            <div class="job-header">
                <h3>${title}</h3>
                ${status}
            </div>
            <div class="job-details">
                <p><strong>Location:</strong> ${job.location || "Not specified"}</p>
                ${meta}
            </div>
            <div class="job-footer">
                <small>${isMatched ? "AI selected" : "Scraped role"}</small>
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
            container.innerHTML = '<div class="empty-state"><p>No jobs found yet. Run a search to get started.</p></div>';
            return;
        }

        container.innerHTML = companyNames.map((company) => {
            const sections = jobs[company];
            const matchedCount = sections.matched?.length || 0;
            const rawCount = sections.raw?.length || 0;

            return `
                <section class="company-section">
                    <div class="company-name">
                        <span class="badge">${company}</span>
                        <small>${matchedCount + rawCount} jobs</small>
                    </div>
                    ${matchedCount > 0 ? `
                        <div class="subsection matched-section">
                            <h3 class="subsection-title">Matched Jobs (${matchedCount})</h3>
                            <div class="jobs-grid">${sections.matched.map((job) => renderJobCard(job, "matched")).join("")}</div>
                        </div>
                    ` : ""}
                    ${rawCount > 0 ? `
                        <div class="subsection raw-section">
                            <h3 class="subsection-title">Scraped Jobs Not Matched (${rawCount})</h3>
                            <div class="jobs-grid">${sections.raw.map((job) => renderJobCard(job, "raw")).join("")}</div>
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
