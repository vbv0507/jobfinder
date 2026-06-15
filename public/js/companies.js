// companies.js - Companies page logic

async function loadCompanies() {
    try {
        const response = await apiCall('/companies');
        const companies = response.companies || [];
        
        const companiesContent = document.getElementById('companies-content');
        
        if (companies.length === 0) {
            companiesContent.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 2rem;">No companies yet</div>';
            return;
        }
        
        const companiesHTML = companies.map(company => `
            <div class="company-card">
                <div class="company-name">${company.name || 'Company'}</div>
                <a href="${company.careerUrl || company.url || '#'}" target="_blank" class="company-url">
                    Visit Careers →
                </a>
            </div>
        `).join('');
        
        companiesContent.innerHTML = companiesHTML;
    } catch (error) {
        document.getElementById('companies-content').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444;">Failed to load companies</div>';
    }
}

// Handle add company form
document.addEventListener('DOMContentLoaded', () => {
    loadCompanies();
    
    const form = document.getElementById('company-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('company-name').value;
            const url = document.getElementById('company-url').value;
            
            try {
                const response = await apiCall('/companies', 'POST', {
                    name,
                    careerUrl: url,
                    category: 'Product',
                    active: true
                });
                
                showAlert('Company added successfully!', 'success');
                form.reset();
                loadCompanies();
            } catch (error) {
                showAlert('Failed to add company', 'error');
            }
        });
    }
});
