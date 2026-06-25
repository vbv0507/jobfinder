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

async function loadCompanies() {
    try {
        const response = await apiCall("/companies");
        const companies = response.companies || [];
        const companiesContent = document.getElementById("companies-content");

        renderScrapingHighlight(companies);

        if (companies.length === 0) {
            companiesContent.innerHTML = '<div class="empty-inline">No companies yet</div>';
            return;
        }

        companiesContent.innerHTML = companies.map((company) => `
            <article class="company-card">
                <div class="company-avatar">${getCompanyIcon(company.name)}</div>
                <h3>${company.name || "Company"}</h3>
                <div class="company-meta">
                    <span class="badge-gray">${company.category || "Unknown"}</span>
                    <span class="status ${company.active ? "active" : "inactive"}">${company.active ? "Active" : "Inactive"}</span>
                </div>
                <a href="${company.careerUrl || "#"}" target="_blank" class="company-url">Visit Careers</a>
            </article>
        `).join("");
    } catch (error) {
        document.getElementById("companies-content").innerHTML = '<div class="error-text">Failed to load companies</div>';
    }
}

document.addEventListener("DOMContentLoaded", loadCompanies);
