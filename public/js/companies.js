// companies.js - Companies page logic
// Matches backend Company model: { name, careerUrl, category, active, scraperType }

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

async function loadCompanies() {
    try {
        const response = await apiCall('/companies');
        const companies = response.companies || [];

        renderScrapingHighlight(companies);

        const companiesContent = document.getElementById('companies-content');

        if (companies.length === 0) {
            companiesContent.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 2rem;">No companies yet</div>';
            return;
        }

        const companiesHTML = companies.map(company => `
            <div class="company-card">
                <div class="company-name">${getCompanyIcon(company.name)} ${company.name || 'Company'}</div>
                <div class="company-meta">
                    <span class="badge">${company.category || 'Unknown'}</span>
                    <span class="status ${company.active ? 'active' : 'inactive'}">
                        ${company.active ? '🟢 Active' : '⚪ Inactive'}
                    </span>
                </div>
                <a href="${company.careerUrl || '#'}" target="_blank" class="company-url">
                    Visit Careers →
                </a>
            </div>
        `).join('');

        companiesContent.innerHTML = companiesHTML;
    } catch (error) {
        document.getElementById('companies-content').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444;">Failed to load companies</div>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadCompanies();
});