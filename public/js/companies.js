function getCompanyIcon(name) {
    const icons = {
        CommerceIQ: "CIQ",
        Visa: "V",
        LG: "LG",
        Adobe: "A",
        Paytm: "P",
        PhonePe: "Ph",
        Groww: "G",
        InMobi: "IM",
        Tekion: "T",
        Thoughtworks: "TW",
        Nagarro: "N",
        Razorpay: "RZ",
        MongoDB: "MDB",
        GitLab: "GL",
        Postman: "PM",
        Databricks: "DB",
        Zeta: "Z",
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

        const renderCompanyCard = (company) => `
            <article class="company-card">
                <div class="company-avatar">${getCompanyIcon(company.name)}</div>
                <h3>${company.name || "Company"}</h3>
                <div class="company-meta">
                    <span class="badge-gray">${company.category || "Unknown"}</span>
                    <span class="status ${company.active ? "active" : "inactive"}">${company.active ? "Active" : "Inactive"}</span>
                </div>
                <a href="${company.careerUrl || "#"}" target="_blank" class="company-url">Visit Careers</a>
            </article>
        `;

        const productCompanies = companies.filter((company) => company.category === "Product");
        const serviceCompanies = companies.filter((company) => company.category === "Service");

        companiesContent.innerHTML = `
            <section class="company-group">
                <div class="company-group-heading">
                    <h3>Product Companies</h3>
                    <span>${productCompanies.length}</span>
                </div>
                <div class="companies-list">${productCompanies.map(renderCompanyCard).join("")}</div>
            </section>
            <section class="company-group">
                <div class="company-group-heading">
                    <h3>Service Companies</h3>
                    <span>${serviceCompanies.length}</span>
                </div>
                <div class="companies-list">${serviceCompanies.map(renderCompanyCard).join("")}</div>
            </section>
        `;
    } catch (error) {
        document.getElementById("companies-content").innerHTML = '<div class="error-text">Failed to load companies</div>';
    }
}

document.addEventListener("DOMContentLoaded", loadCompanies);
