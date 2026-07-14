const fs = require('fs');
const path = require('path');
const companies = require('./companies');

const normalizeCompanyName = (name) => {
    if (!name) return 'default';
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const getBrandColor = (companyName) => {
    if (!companyName) return '#64748b';
    
    // A curated list of beautiful, brand-inspired professional colors
    const colors = [
        '#00a4ef', // Microsoft Blue
        '#f25022', // Microsoft Red
        '#ffb900', // Microsoft Yellow
        '#7fba00', // Microsoft Green
        '#ea4335', // Google Red
        '#4285f4', // Google Blue
        '#fbbc05', // Google Yellow
        '#34a853', // Google Green
        '#ff9900', // Amazon Orange
        '#e2231a', // Adobe Red
        '#c74634', // Oracle Red
        '#008cdd', // Salesforce Blue
        '#6366f1', // Indigo
        '#8b5cf6', // Violet
        '#ec4899', // Pink
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#3b82f6', // Blue
    ];

    let hash = 0;
    for (let i = 0; i < companyName.length; i++) {
        hash = companyName.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    return colors[hash % colors.length];
};

const getCompanyLogo = (companyName) => {
    if (!companyName) return '/logos/default.svg';

    const normalizedName = normalizeCompanyName(companyName);
    
    // Check if SVG exists locally
    const svgPath = path.join(__dirname, '..', 'public', 'logos', 'companies', `${normalizedName}.svg`);
    if (fs.existsSync(svgPath)) {
        return `/logos/companies/${normalizedName}.svg`;
    }

    // Check if PNG exists locally
    const pngPath = path.join(__dirname, '..', 'public', 'logos', 'companies', `${normalizedName}.png`);
    if (fs.existsSync(pngPath)) {
        return `/logos/companies/${normalizedName}.png`;
    }

    // Generate Avatar Fallback using Data URI
    const color = getBrandColor(companyName);
    const initial = companyName.charAt(0).toUpperCase();
    
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="50" fill="${color}" /><text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Inter, Roboto, Arial, sans-serif" font-size="50" font-weight="bold" fill="#ffffff">${initial}</text></svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
};

const getCompanyData = (companyName) => {
    if (!companyName) return null;
    const normalizedTarget = normalizeCompanyName(companyName);
    return companies.find(c => normalizeCompanyName(c.name) === normalizedTarget) || null;
};

const getDisplayName = (companyName) => {
    const data = getCompanyData(companyName);
    return data ? data.name : (companyName || 'Unknown Company');
};

const getIndustry = (companyName) => {
    const data = getCompanyData(companyName);
    return data ? data.category : 'Technology'; // Fallback industry
};

const getCompanyWebsite = (companyName) => {
    const data = getCompanyData(companyName);
    if (data && data.careerUrl) {
        try {
            const url = new URL(data.careerUrl);
            return `${url.protocol}//${url.hostname}`;
        } catch (e) {
            return data.careerUrl;
        }
    }
    return '#';
};

module.exports = {
    getCompanyLogo,
    getBrandColor,
    getDisplayName,
    getIndustry,
    getCompanyWebsite
};
