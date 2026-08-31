const ExcelJS = require('exceljs');
const { chromium } = require('playwright');
const MatchedJob = require('../models/MatchedJob');
const RejectedJob = require('../models/RejectedJob');
const RawJob = require('../models/RawJob');
const Company = require('../models/Company');

/**
 * Normalizes dates to readable human format (IST / UTC)
 */
const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'N/A';
    }
};

const formatDateShort = (date) => {
    if (!date) return 'N/A';
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return 'N/A';
    }
};

/**
 * Collects and normalizes unified job records based on requested scope.
 * Scopes: 'all', 'matched', 'applied', 'saved', 'rejected', 'local'
 */
async function fetchJobsByScope(scope = 'all', filters = {}) {
    const scopeLower = (scope || 'all').toLowerCase();
    const normalizedList = [];

    // Preload company lookup map
    const allCompanies = await Company.find({}).lean();
    const companyMap = new Map();
    allCompanies.forEach(c => companyMap.set(c._id.toString(), c.name));

    const getCompanyName = (job) => {
        if (job.company && typeof job.company === 'object' && job.company.name) {
            return job.company.name;
        }
        if (job.company && companyMap.has(job.company.toString())) {
            return companyMap.get(job.company.toString());
        }
        return 'Unknown / Custom';
    };

    // 1. Fetch Matched Jobs (Applied, Saved, Matched, Local, etc.)
    if (['all', 'matched', 'applied', 'saved', 'local'].includes(scopeLower)) {
        let matchQuery = {};
        if (scopeLower === 'applied') {
            matchQuery = { $or: [{ status: 'applied' }, { appliedAt: { $ne: null } }] };
        } else if (scopeLower === 'saved') {
            matchQuery = { status: 'saved' };
        } else if (scopeLower === 'local') {
            matchQuery = { provider: 'local' };
        } else if (scopeLower === 'matched') {
            matchQuery = { status: { $in: ['new', 'saved', 'applied'] } };
        }

        const matchedDocs = await MatchedJob.find(matchQuery)
            .populate('company', 'name logo careerUrl')
            .populate('rawJob', 'description scrapedAt postedAt experience salary jobId')
            .sort({ score: -1, createdAt: -1 })
            .lean();

        for (const m of matchedDocs) {
            const raw = m.rawJob || {};
            const breakdown = m.scoringBreakdown || {};
            const breakdownStr = [
                breakdown.roleMatch != null ? `Role: ${breakdown.roleMatch}%` : null,
                breakdown.skillsMatch != null ? `Skills: ${breakdown.skillsMatch}%` : null,
                breakdown.experienceMatch != null ? `Exp: ${breakdown.experienceMatch}%` : null,
                breakdown.domainMatch != null ? `Domain: ${breakdown.domainMatch}%` : null,
                breakdown.locationMatch != null ? `Loc: ${breakdown.locationMatch}%` : null
            ].filter(Boolean).join(' | ') || 'N/A';

            let categoryStatus = 'Matched';
            if (m.status === 'applied' || m.appliedAt) categoryStatus = 'Applied';
            else if (m.status === 'saved') categoryStatus = 'Saved';
            else if (m.status === 'rejected') categoryStatus = 'Rejected (User)';
            else if (m.provider === 'local') categoryStatus = 'Local Evaluation';

            normalizedList.push({
                id: m._id.toString(),
                jobId: raw.jobId || m.jobId || 'N/A',
                companyName: getCompanyName(m),
                title: m.role || raw.title || 'Untitled Role',
                location: m.location || raw.location || 'Remote / India',
                categoryStatus,
                score: typeof m.score === 'number' ? m.score : 'N/A',
                scoringBreakdown: breakdownStr,
                evaluatedBy: m.evaluatedBy || (m.provider ? m.provider.toUpperCase() : 'N/A'),
                provider: m.provider || m.evaluatedBy || 'N/A',
                model: m.model || 'N/A',
                postedDate: formatDateShort(m.postedAt || raw.postedAt),
                scrapedDate: formatDate(m.createdAt || m.lastScrapedAt || raw.scrapedAt),
                appliedDate: (m.status === 'applied' || m.appliedAt) ? formatDate(m.appliedAt || m.updatedAt) : 'Not Applied',
                isApplied: m.status === 'applied' || !!m.appliedAt,
                matchReason: m.reason || (m.strengths && m.strengths.length ? m.strengths.join('; ') : 'Met qualification thresholds'),
                rejectionReason: 'N/A (Accepted Match)',
                matchedSkills: (m.matchedSkills && m.matchedSkills.length) ? m.matchedSkills.join(', ') : 'N/A',
                missingSkills: (m.missingSkills && m.missingSkills.length) ? m.missingSkills.join(', ') : 'None identified',
                strengths: (m.strengths && m.strengths.length) ? m.strengths.join('; ') : 'N/A',
                weaknesses: (m.weaknesses && m.weaknesses.length) ? m.weaknesses.join('; ') : 'None',
                mandatoryRequirements: (m.mandatoryRequirements && m.mandatoryRequirements.length) ? m.mandatoryRequirements.join('; ') : 'N/A',
                description: (raw.description || m.description || m.role || '').slice(0, 1500),
                applyLink: m.applyLink || raw.applyLink || '',
                notes: m.notes || ''
            });
        }
    }

    // 2. Fetch Rejected Jobs
    if (['all', 'rejected'].includes(scopeLower)) {
        const rejectedDocs = await RejectedJob.find({})
            .select('role company score reason missingSkills weaknesses applyLink postedAt createdAt location provider model scoringBreakdown mandatoryRequirements notes')
            .populate('company', 'name')
            .sort({ createdAt: -1 })
            .lean();

        for (const r of rejectedDocs) {
            const breakdown = r.scoringBreakdown || {};
            const breakdownStr = [
                breakdown.roleMatch != null ? `Role: ${breakdown.roleMatch}%` : null,
                breakdown.skillsMatch != null ? `Skills: ${breakdown.skillsMatch}%` : null,
                breakdown.experienceMatch != null ? `Exp: ${breakdown.experienceMatch}%` : null,
                breakdown.domainMatch != null ? `Domain: ${breakdown.domainMatch}%` : null,
                breakdown.locationMatch != null ? `Loc: ${breakdown.locationMatch}%` : null
            ].filter(Boolean).join(' | ') || 'N/A';

            normalizedList.push({
                id: r._id.toString(),
                jobId: r.jobId || 'N/A',
                companyName: getCompanyName(r),
                title: r.role || 'Untitled Role',
                location: r.location || 'Remote / India',
                categoryStatus: 'Rejected (AI)',
                score: typeof r.score === 'number' ? r.score : 'N/A',
                scoringBreakdown: breakdownStr,
                evaluatedBy: r.evaluatedBy || (r.provider ? r.provider.toUpperCase() : 'AI Filter'),
                provider: r.provider || r.evaluatedBy || 'AI Filter',
                model: r.model || 'N/A',
                postedDate: formatDateShort(r.postedAt),
                scrapedDate: formatDate(r.createdAt || r.lastScrapedAt),
                appliedDate: 'Not Applied',
                isApplied: false,
                matchReason: 'N/A (Disqualified)',
                rejectionReason: r.reason || (r.weaknesses && r.weaknesses.length ? r.weaknesses.join('; ') : 'Did not meet profile criteria'),
                matchedSkills: (r.matchedSkills && r.matchedSkills.length) ? r.matchedSkills.join(', ') : 'N/A',
                missingSkills: (r.missingSkills && r.missingSkills.length) ? r.missingSkills.join(', ') : 'N/A',
                strengths: (r.strengths && r.strengths.length) ? r.strengths.join('; ') : 'N/A',
                weaknesses: (r.weaknesses && r.weaknesses.length) ? r.weaknesses.join('; ') : 'N/A',
                mandatoryRequirements: (r.mandatoryRequirements && r.mandatoryRequirements.length) ? r.mandatoryRequirements.join('; ') : 'N/A',
                description: (r.description || r.role || '').slice(0, 1500),
                applyLink: r.applyLink || '',
                notes: r.notes || ''
            });
        }
    }

    // 3. If Scope is 'all', also capture Raw / Pending jobs that haven't been evaluated
    if (scopeLower === 'all') {
        const rawDocs = await RawJob.find({ aiEvaluated: false })
            .populate('company', 'name')
            .sort({ scrapedAt: -1 })
            .limit(200)
            .lean();

        for (const raw of rawDocs) {
            normalizedList.push({
                id: raw._id.toString(),
                jobId: raw.jobId || 'N/A',
                companyName: getCompanyName(raw),
                title: raw.title || 'Untitled Role',
                location: raw.location || 'India',
                categoryStatus: 'Pending / Unevaluated',
                score: 'Pending',
                scoringBreakdown: 'Pending Evaluation',
                evaluatedBy: 'None (Raw Discovery)',
                provider: 'Pending',
                model: 'Pending',
                postedDate: formatDateShort(raw.postedAt),
                scrapedDate: formatDate(raw.scrapedAt || raw.createdAt),
                appliedDate: 'Not Applied',
                isApplied: false,
                matchReason: 'Pending Evaluation',
                rejectionReason: 'Pending Evaluation',
                matchedSkills: 'Pending',
                missingSkills: 'Pending',
                strengths: 'Pending',
                weaknesses: 'Pending',
                mandatoryRequirements: 'N/A',
                description: (raw.description || '').slice(0, 1500),
                applyLink: raw.applyLink || '',
                notes: ''
            });
        }
    }

    return normalizedList;
}

/**
 * Generates styled Excel spreadsheet Buffer using ExcelJS
 */
async function generateExcelBuffer(jobs, scope = 'all') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RoleNova Autonomous Job Platform';
    workbook.created = new Date();

    const scopeTitle = `${scope.toUpperCase()} JOBS`;
    const worksheet = workbook.addWorksheet(scopeTitle.slice(0, 30), {
        views: [{ state: 'frozen', ySplit: 2 }]
    });

    // Column Definitions & Widths (16 Distinct Columns)
    worksheet.columns = [
        { key: 'companyName', width: 26 },
        { key: 'title', width: 36 },
        { key: 'categoryStatus', width: 22 },
        { key: 'score', width: 15 },
        { key: 'scoringBreakdown', width: 36 },
        { key: 'evaluatedBy', width: 22 },
        { key: 'location', width: 24 },
        { key: 'postedDate', width: 18 },
        { key: 'scrapedDate', width: 22 },
        { key: 'appliedDate', width: 22 },
        { key: 'matchReason', width: 45 },
        { key: 'rejectionReason', width: 45 },
        { key: 'matchedSkills', width: 30 },
        { key: 'missingSkills', width: 30 },
        { key: 'description', width: 50 },
        { key: 'applyLink', width: 35 }
    ];

    // Row 1: Executive Title Banner
    worksheet.mergeCells('A1:P1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `🌟 RoleNova Job Intelligence — ${scope.toUpperCase()} JOBS AUDIT REPORT (${jobs.length} Total Records) • Generated: ${new Date().toLocaleString('en-IN')}`;
    titleCell.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Dark Slate Navy #0F172A
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    worksheet.getRow(1).height = 36;

    // Row 2: Prominent, Clearly Visible Column Headers
    const headers = [
        'Company Name & Domain',
        'Role Title & Job ID',
        'Application / Category Status',
        'AI Fit Score (0-100)',
        'Scoring Breakdown',
        'AI Evaluator & Model',
        'Location & Work Mode',
        'Job Posted Date',
        'When Scraped',
        'When Applied',
        'Reason Why Matched / Strengths',
        'Reason for Rejection / Missing Skills',
        'Matched Skills',
        'Missing Skills',
        'Job Description / Requirements',
        'Direct Application Link'
    ];

    const headerRow = worksheet.getRow(2);
    headerRow.values = headers;
    headerRow.height = 32;
    headerRow.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Dark Slate #1E293B
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF3B82F6' } },
            bottom: { style: 'medium', color: { argb: 'FF3B82F6' } },
            left: { style: 'thin', color: { argb: 'FF334155' } },
            right: { style: 'thin', color: { argb: 'FF334155' } }
        };
    });

    // Auto-filter on Row 2
    worksheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2, column: 16 }
    };

    // Populate Data Rows (Row 3 onwards)
    jobs.forEach((job, index) => {
        const row = worksheet.addRow({
            companyName: job.companyName,
            title: job.title,
            categoryStatus: job.categoryStatus,
            score: typeof job.score === 'number' ? `${job.score}/100` : job.score,
            scoringBreakdown: job.scoringBreakdown,
            evaluatedBy: job.evaluatedBy,
            location: job.location,
            postedDate: job.postedDate,
            scrapedDate: job.scrapedDate,
            appliedDate: job.appliedDate,
            matchReason: job.matchReason,
            rejectionReason: job.rejectionReason,
            matchedSkills: job.matchedSkills,
            missingSkills: job.missingSkills,
            description: job.description,
            applyLink: job.applyLink
        });

        row.height = 26;
        const isEven = index % 2 === 0;
        const bgArgb = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

        row.eachCell((cell, colNumber) => {
            cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF1E293B' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: [5, 11, 12, 15].includes(colNumber) };

            // Status Column Badge Styling (Column 3)
            if (colNumber === 3) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.font = { name: 'Segoe UI', size: 9.5, bold: true };
                if (job.categoryStatus === 'Applied') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; // Light blue
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                } else if (job.categoryStatus === 'Matched') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }; // Light green
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF15803D' } };
                } else if (job.categoryStatus.includes('Rejected')) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } }; // Light red
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFBE123C' } };
                } else if (job.categoryStatus === 'Saved') {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } }; // Light purple
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF7E22CE' } };
                }
            }

            // Score Column Styling (Column 4)
            if (colNumber === 4) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                if (typeof job.score === 'number') {
                    cell.font = { name: 'Segoe UI', size: 10, bold: true };
                    if (job.score >= 70) cell.font.color = { argb: 'FF15803D' };
                    else if (job.score >= 40) cell.font.color = { argb: 'FFB45309' };
                    else cell.font.color = { argb: 'FFB91C1C' };
                }
            }

            // Hyperlink on Apply Link (Column 16)
            if (colNumber === 16 && job.applyLink) {
                cell.value = {
                    text: 'Open Application Portal ↗',
                    hyperlink: job.applyLink,
                    tooltip: job.applyLink
                };
                cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF2563EB' }, underline: true };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            }
        });
    });

    return await workbook.xlsx.writeBuffer();
}

/**
 * Generates high-resolution, styled PDF Buffer using Playwright HTML-to-PDF
 */
async function generatePdfBuffer(jobs, scope = 'all') {
    const scopeLabel = scope.toUpperCase() + ' JOBS';
    const totalJobs = jobs.length;
    const matchedCount = jobs.filter(j => j.categoryStatus === 'Matched').length;
    const appliedCount = jobs.filter(j => j.categoryStatus === 'Applied').length;
    const rejectedCount = jobs.filter(j => j.categoryStatus.includes('Rejected')).length;
    const savedCount = jobs.filter(j => j.categoryStatus === 'Saved').length;

    const scoresList = jobs.map(j => j.score).filter(s => typeof s === 'number');
    const avgScore = scoresList.length ? Math.round(scoresList.reduce((a, b) => a + b, 0) / scoresList.length) : 'N/A';

    // For PDF readability and Chromium rendering limits, render top 300 positions
    const maxPdfRows = 300;
    const isTruncated = jobs.length > maxPdfRows;
    const displayJobs = jobs.slice(0, maxPdfRows);

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>RoleNova Job Export</title>
        <style>
            @page {
                size: A4 landscape;
                margin: 10mm 8mm 12mm 8mm;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color: #0f172a;
                background: #ffffff;
                margin: 0;
                padding: 0;
                font-size: 8pt;
                line-height: 1.3;
            }
            .header-container {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 2px solid #3b82f6;
                padding-bottom: 8px;
                margin-bottom: 10px;
            }
            .brand-title {
                font-size: 15pt;
                font-weight: 800;
                color: #0f172a;
                letter-spacing: -0.5px;
            }
            .brand-title span {
                color: #3b82f6;
            }
            .report-meta {
                text-align: right;
                font-size: 7.5pt;
                color: #64748b;
            }
            .metrics-grid {
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                gap: 8px;
                margin-bottom: 10px;
            }
            .metric-card {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                padding: 6px 8px;
                text-align: center;
            }
            .metric-label {
                font-size: 6.5pt;
                font-weight: 700;
                text-transform: uppercase;
                color: #64748b;
                letter-spacing: 0.5px;
            }
            .metric-val {
                font-size: 11pt;
                font-weight: 800;
                color: #0f172a;
                margin-top: 2px;
            }
            .truncation-notice {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
                border-radius: 6px;
                padding: 5px 10px;
                margin-bottom: 10px;
                font-size: 7.5pt;
                color: #1e40af;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                page-break-inside: auto;
            }
            tr {
                page-break-inside: avoid;
                page-break-after: auto;
            }
            thead {
                display: table-header-group;
            }
            th {
                background: #0f172a;
                color: #f8fafc;
                font-size: 7pt;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                padding: 5px 6px;
                border: 1px solid #334155;
                text-align: left;
            }
            td {
                padding: 5px 6px;
                border: 1px solid #e2e8f0;
                vertical-align: top;
                font-size: 7.5pt;
            }
            tr:nth-child(even) td {
                background: #f8fafc;
            }
            .badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: 700;
                font-size: 6.5pt;
                text-transform: uppercase;
            }
            .badge-matched { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
            .badge-applied { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
            .badge-saved { background: #f3e8ff; color: #7e22ce; border: 1px solid #e9d5ff; }
            .badge-rejected { background: #ffe4e6; color: #be123c; border: 1px solid #fecdd3; }
            .badge-pending { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
            .score-badge {
                font-weight: 800;
                font-size: 8.5pt;
            }
            .score-high { color: #16a34a; }
            .score-med { color: #d97706; }
            .score-low { color: #dc2626; }
            .apply-btn {
                color: #2563eb;
                text-decoration: none;
                font-weight: 600;
                font-size: 7pt;
                display: block;
                word-break: break-all;
            }
            .reason-box {
                font-size: 7pt;
                color: #334155;
                line-height: 1.25;
            }
            .skills-tag {
                font-size: 6.5pt;
                color: #475569;
                margin-top: 2px;
            }
            .footer-info {
                margin-top: 10px;
                font-size: 6.5pt;
                color: #94a3b8;
                display: flex;
                justify-content: space-between;
                border-top: 1px solid #e2e8f0;
                padding-top: 4px;
            }
        </style>
    </head>
    <body>
        <div class="header-container">
            <div>
                <div class="brand-title">RoleNova <span>Job Audit & Intelligence</span></div>
                <div style="font-size: 8.5pt; font-weight: 600; color: #475569; margin-top: 2px;">
                    Scope: ${scopeLabel} • ${totalJobs} Total Identified Positions
                </div>
            </div>
            <div class="report-meta">
                <div><strong>Generated:</strong> ${new Date().toLocaleString('en-IN')}</div>
                <div><strong>Platform:</strong> RoleNova Autonomous Engine</div>
            </div>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Total Jobs</div>
                <div class="metric-val">${totalJobs}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Applied</div>
                <div class="metric-val" style="color: #0284c7;">${appliedCount}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">AI Matched</div>
                <div class="metric-val" style="color: #16a34a;">${matchedCount}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Saved</div>
                <div class="metric-val" style="color: #9333ea;">${savedCount}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Rejected</div>
                <div class="metric-val" style="color: #e11d48;">${rejectedCount}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Avg AI Score</div>
                <div class="metric-val">${avgScore !== 'N/A' ? avgScore + '/100' : 'N/A'}</div>
            </div>
        </div>

        ${isTruncated ? `
        <div class="truncation-notice">
            <span><strong>PDF Executive Preview:</strong> Showing top ${maxPdfRows} highest-priority records. For the complete ${totalJobs} dataset with full descriptions, download the <strong>Microsoft Excel (.xlsx)</strong> export.</span>
            <span>Total Records: ${totalJobs}</span>
        </div>
        ` : ''}

        <table>
            <thead>
                <tr>
                    <th style="width: 14%;">Company & Role</th>
                    <th style="width: 8%;">Status</th>
                    <th style="width: 6%; text-align: center;">Score</th>
                    <th style="width: 11%;">Evaluator & Location</th>
                    <th style="width: 9%;">Dates</th>
                    <th style="width: 25%;">Match Analysis / Strengths</th>
                    <th style="width: 17%;">Disqualification / Missing</th>
                    <th style="width: 10%;">Apply Link</th>
                </tr>
            </thead>
            <tbody>
                ${displayJobs.map((j) => {
                    let badgeClass = 'badge-pending';
                    if (j.categoryStatus === 'Applied') badgeClass = 'badge-applied';
                    else if (j.categoryStatus === 'Matched') badgeClass = 'badge-matched';
                    else if (j.categoryStatus === 'Saved') badgeClass = 'badge-saved';
                    else if (j.categoryStatus.includes('Rejected')) badgeClass = 'badge-rejected';

                    let scoreClass = 'score-med';
                    if (typeof j.score === 'number') {
                        if (j.score >= 70) scoreClass = 'score-high';
                        else if (j.score < 40) scoreClass = 'score-low';
                    }

                    return `
                    <tr>
                        <td>
                            <strong style="color: #0f172a; font-size: 8pt;">${escapeHtml(j.companyName)}</strong><br/>
                            <span style="color: #334155;">${escapeHtml(j.title)}</span>
                            ${j.jobId && j.jobId !== 'N/A' ? `<br/><span style="font-size: 6.5pt; color: #94a3b8;">ID: ${escapeHtml(j.jobId)}</span>` : ''}
                        </td>
                        <td>
                            <span class="badge ${badgeClass}">${escapeHtml(j.categoryStatus)}</span>
                        </td>
                        <td style="text-align: center;">
                            <span class="score-badge ${scoreClass}">${typeof j.score === 'number' ? j.score : j.score}</span>
                        </td>
                        <td>
                            <strong>${escapeHtml(j.evaluatedBy)}</strong><br/>
                            <span style="color: #64748b;">${escapeHtml(j.location)}</span>
                        </td>
                        <td>
                            <span style="color: #64748b;">Posted:</span> ${escapeHtml(j.postedDate)}<br/>
                            <span style="color: #64748b;">Scraped:</span> ${escapeHtml(j.scrapedDate.split(',')[0])}<br/>
                            ${j.isApplied ? `<span style="color: #0284c7; font-weight: 700;">Applied: ${escapeHtml(j.appliedDate.split(',')[0])}</span>` : ''}
                        </td>
                        <td>
                            <div class="reason-box">${escapeHtml(j.matchReason)}</div>
                            ${j.matchedSkills !== 'N/A' ? `<div class="skills-tag"><strong>Skills:</strong> ${escapeHtml(j.matchedSkills)}</div>` : ''}
                        </td>
                        <td>
                            <div class="reason-box">${escapeHtml(j.rejectionReason)}</div>
                            ${j.missingSkills !== 'N/A' && j.missingSkills !== 'None identified' ? `<div class="skills-tag"><strong>Missing:</strong> ${escapeHtml(j.missingSkills)}</div>` : ''}
                        </td>
                        <td>
                            ${j.applyLink ? `<a href="${escapeHtml(j.applyLink)}" class="apply-btn" target="_blank">Open Job ↗</a>` : '<span style="color:#94a3b8;">N/A</span>'}
                        </td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>

        <div class="footer-info">
            <div>RoleNova Autonomous Job Platform • Confidential Job Intelligence Report</div>
            <div>${displayJobs.length} Jobs Rendered (Total Database: ${totalJobs})</div>
    </body>
    </html>
    `;

    let browser = null;
    try {
        try {
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(400);

            const pdfBuffer = await page.pdf({
                format: 'A4',
                landscape: true,
                printBackground: true,
                margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' }
            });

            await page.close().catch(() => {});
            return pdfBuffer;
        } catch (pwErr) {
            console.warn("[PDF Export] Playwright launch failed, trying Puppeteer fallback:", pwErr.message);
            const puppeteer = require('puppeteer');
            const pBrowser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            const pPage = await pBrowser.newPage();
            await pPage.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
            const pdfBuffer = await pPage.pdf({
                format: 'A4',
                landscape: true,
                printBackground: true,
                margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' }
            });
            await pBrowser.close().catch(() => {});
            return pdfBuffer;
        }
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    fetchJobsByScope,
    generateExcelBuffer,
    generatePdfBuffer
};
