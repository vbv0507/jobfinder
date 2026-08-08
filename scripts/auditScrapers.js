#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pLimitModule = require('p-limit');
const pLimit = pLimitModule.default || pLimitModule;
const mongoose = require('mongoose');

const CompanyModel = require('../models/Company');
const AdapterFactory = require('../services/ats/AdapterFactory');
const LightweightHtmlAdapter = require('../services/ats/providers/Fallback/LightweightHtmlAdapter');

const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_DIR = path.join(__dirname, '..', 'reports');
const JSON_REPORT_PATH = path.join(REPORT_DIR, `scrape-audit-${REPORT_DATE}.json`);
const MARKDOWN_REPORT_PATH = path.join(REPORT_DIR, `scrape-audit-${REPORT_DATE}.md`);
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 2);
const PER_COMPANY_TIMEOUT_MS = 6 * 60 * 1000;
const SDE_KEYWORDS = /\b(sde|software engineer|software development engineer|full stack|frontend|backend|developer|node|java|python|golang|data engineer|devops)\b/i;
const ANTI_BOT_ERROR_PATTERN = /\b(blocked|cloudflare|captcha|incapsula|anti-?bot|bot protection|access denied|forbidden|challenge)\b/i;

const safeSuffix = (value) => String(value ?? '').trim();

const normalizeCompany = (company) => ({
  ...company,
  name: safeSuffix(company.name || company.companyName || company.company || 'Unknown Company'),
  careerUrl: safeSuffix(company.careerUrl || company.careerPageUrl || company.careersUrl || company.url || ''),
  ats: safeSuffix(company.ats || company.scraperConfig?.ats || 'custom'),
  adapter: company.adapter || null,
});

const loadCompanies = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (mongoUri) {
    try {
      if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      }

      const docs = await CompanyModel.find({ active: true }).lean();
      if (Array.isArray(docs) && docs.length > 0) {
        return docs.map(normalizeCompany);
      }
    } catch (error) {
      console.warn(`[Audit] MongoDB read failed, falling back to utils/companies.js: ${error.message}`);
    }
  }

  const fallbackCompanies = require('../utils/companies');
  return (fallbackCompanies || [])
    .filter((company) => company && company.active !== false)
    .map(normalizeCompany);
};

const runWithTimeout = async (fn, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    Promise.resolve()
      .then(fn)
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
};

const summarizeJobs = (jobs = []) => {
  return jobs.slice(0, 3).map((job) => ({
    title: safeSuffix(job.title || job.role || job.name || ''),
    applyLink: safeSuffix(job.applyLink || job.url || job.link || ''),
    experience: safeSuffix(job.experience || ''),
    source: safeSuffix(job.source || ''),
    description: safeSuffix(job.description || ''),
  }));
};

const isSdeLike = (job = {}) => {
  const haystack = [job.title, job.description, job.experience, job.location, job.role].join(' ');
  return SDE_KEYWORDS.test(haystack);
};

const getAdapterName = (adapter) => adapter?.constructor?.name || 'unknown';
const isAntiBotBlockedError = (error) => ANTI_BOT_ERROR_PATTERN.test(String(error?.message || error || ''));

const auditCompany = async (company, index, total) => {
  const companyName = company.name;
  console.log(`[Audit ${index}/${total}] ${companyName}`);

  const record = {
    name: companyName,
    careerUrl: company.careerUrl,
    ats: company.ats,
    primaryAdapter: getAdapterName(null),
    parserName: null,
    parserVersion: null,
    jobsFound: 0,
    primaryJobs: [],
    sdeLikePrimary: false,
    primaryTrail: [],
    droppedJobsCount: 0,
    fallbackAttempted: false,
    fallbackRecovered: false,
    fallbackJobsFound: 0,
    fallbackJobs: [],
    fallbackTrail: [],
    fallbackSdeLike: false,
    skippedBlocked: false,
    error: null,
    needsAttention: false,
  };

  try {
    const adapter = AdapterFactory.getAdapter(company);
    record.primaryAdapter = getAdapterName(adapter);
    record.parserName = adapter.parserName || null;
    record.parserVersion = adapter.parserVersion || null;

    const result = await runWithTimeout(() => adapter.searchJobs(), PER_COMPANY_TIMEOUT_MS);
    const jobs = Array.isArray(result) ? result : [];

    record.jobsFound = jobs.length;
    record.primaryJobs = summarizeJobs(jobs);
    record.sdeLikePrimary = jobs.some(isSdeLike);
    record.primaryTrail = Array.isArray(adapter.trail) ? adapter.trail : [];
    record.droppedJobsCount = Array.isArray(adapter.droppedJobs) ? adapter.droppedJobs.length : 0;

    if (record.primaryTrail.some((entry) => ANTI_BOT_ERROR_PATTERN.test(String(entry.message || '')))) {
      record.skippedBlocked = true;
      record.error = null;
      return record;
    }

    if (jobs.length === 0 && !(adapter instanceof LightweightHtmlAdapter)) {
      record.fallbackAttempted = true;
      let fallbackAdapter = new LightweightHtmlAdapter(company);
      try {
        const fallbackJobs = await runWithTimeout(() => fallbackAdapter.searchJobs(), PER_COMPANY_TIMEOUT_MS);
        const normalizedFallbackJobs = Array.isArray(fallbackJobs) ? fallbackJobs : [];
        record.fallbackRecovered = normalizedFallbackJobs.length > 0;
        record.fallbackJobsFound = normalizedFallbackJobs.length;
        record.fallbackJobs = summarizeJobs(normalizedFallbackJobs);
        record.fallbackSdeLike = normalizedFallbackJobs.some(isSdeLike);
        record.fallbackTrail = Array.isArray(fallbackAdapter.trail) ? fallbackAdapter.trail : [];
        if (record.fallbackTrail.some((entry) => ANTI_BOT_ERROR_PATTERN.test(String(entry.message || '')))) {
          record.skippedBlocked = true;
          record.error = null;
        }
      } catch (fallbackError) {
        if (isAntiBotBlockedError(fallbackError)) {
          record.skippedBlocked = true;
          record.error = null;
          record.fallbackTrail = Array.isArray(fallbackAdapter.trail) ? fallbackAdapter.trail : [];
        } else {
          record.error = fallbackError.message || String(fallbackError);
        }
      }
    }
  } catch (error) {
    if (isAntiBotBlockedError(error)) {
      record.skippedBlocked = true;
      record.error = null;
    } else {
      record.error = error.message || String(error);
    }
  }

  if (!record.error && !record.skippedBlocked && record.jobsFound === 0 && !record.fallbackRecovered) {
    record.needsAttention = true;
  }

  if (record.error && record.error.includes('Timed out')) {
    record.needsAttention = true;
  }

  return record;
};

const buildSummary = (results) => {
  const summary = {
    totalActiveCompanies: results.length,
    companiesWithJobs: results.filter((result) => result.jobsFound > 0).length,
    companiesRecoveredByFallback: results.filter((result) => result.fallbackRecovered).length,
    companiesStillZeroAfterFallback: results.filter((result) => result.jobsFound === 0 && !result.fallbackRecovered && !result.error && !result.skippedBlocked).length,
    companiesSkippedByAntiBot: results.filter((result) => result.skippedBlocked).length,
    companiesWithScrapeErrors: results.filter((result) => Boolean(result.error)).length,
    companiesWithSdeJobs: results.filter((result) => result.sdeLikePrimary || result.fallbackSdeLike).length,
    topFailures: {},
    needsAttention: results.filter((result) => result.needsAttention).map((result) => ({
      name: result.name,
      reason: result.error || 'No jobs found after primary + fallback',
      careerUrl: result.careerUrl,
    })),
  };

  const failureBuckets = results.reduce((accumulator, result) => {
    if (!result.error || result.skippedBlocked) return accumulator;
    const reason = result.error.includes('Timed out') ? 'Timeout' : 'Scrape error';
    accumulator[reason] = (accumulator[reason] || 0) + 1;
    return accumulator;
  }, {});

  summary.topFailures = failureBuckets;
  return summary;
};

const buildMarkdown = (results, summary) => {
  const lines = [];
  lines.push('# Scrape Audit Report');
  lines.push('');
  lines.push(`- Generated: ${REPORT_DATE}`);
  lines.push(`- Total active companies tested: ${summary.totalActiveCompanies}`);
  lines.push(`- Companies with jobs from primary adapter: ${summary.companiesWithJobs}`);
  lines.push(`- Companies recovered by zero-job fallback: ${summary.companiesRecoveredByFallback}`);
  lines.push(`- Companies still zero after fallback: ${summary.companiesStillZeroAfterFallback}`);
  lines.push(`- Companies skipped by anti-bot protection: ${summary.companiesSkippedByAntiBot}`);
  lines.push(`- Companies with scrape errors: ${summary.companiesWithScrapeErrors}`);
  lines.push(`- Companies with SDE-like jobs: ${summary.companiesWithSdeJobs}`);
  lines.push('');
  lines.push('## Top failures');
  if (Object.keys(summary.topFailures).length === 0) {
    lines.push('- None');
  } else {
    Object.entries(summary.topFailures).forEach(([reason, count]) => {
      lines.push(`- ${reason}: ${count}`);
    });
  }
  lines.push('');
  lines.push('## Companies needing attention');
  if (summary.needsAttention.length === 0) {
    lines.push('- None');
  } else {
    summary.needsAttention.forEach((item) => {
      lines.push(`- ${item.name}: ${item.reason}`);
      lines.push(`  - Career URL: ${item.careerUrl || 'n/a'}`);
    });
  }
  lines.push('');
  lines.push('## Detailed results');
  results.forEach((result) => {
    lines.push(`### ${result.name}`);
    lines.push(`- ATS: ${result.ats}`);
    lines.push(`- Career URL: ${result.careerUrl || 'n/a'}`);
    lines.push(`- Primary adapter: ${result.primaryAdapter}`);
    lines.push(`- Parser: ${result.parserName || 'n/a'} ${result.parserVersion || ''}`.trim());
    lines.push(`- Primary jobs found: ${result.jobsFound}`);
    lines.push(`- SDE-like primary: ${result.sdeLikePrimary ? 'yes' : 'no'}`);
    lines.push(`- Fallback attempted: ${result.fallbackAttempted ? 'yes' : 'no'}`);
    lines.push(`- Fallback recovered: ${result.fallbackRecovered ? 'yes' : 'no'}`);
    lines.push(`- Fallback jobs found: ${result.fallbackJobsFound}`);
    lines.push(`- Dropped jobs count: ${result.droppedJobsCount}`);
    lines.push(`- Skipped by anti-bot protection: ${result.skippedBlocked ? 'yes' : 'no'}`);
    if (result.error) {
      lines.push(`- Error: ${result.error}`);
    }
    if (result.primaryJobs.length > 0) {
      lines.push('- Primary first jobs:');
      result.primaryJobs.forEach((job) => {
        lines.push(`  - ${job.title || '(no title)'} | ${job.applyLink || 'n/a'} | ${job.experience || 'n/a'}`);
      });
    }
    if (result.fallbackJobs.length > 0) {
      lines.push('- Fallback first jobs:');
      result.fallbackJobs.forEach((job) => {
        lines.push(`  - ${job.title || '(no title)'} | ${job.applyLink || 'n/a'} | ${job.experience || 'n/a'}`);
      });
    }
    lines.push('');
  });

  return lines.join('\n');
};

const main = async () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const companies = await loadCompanies();
  const limit = pLimit(Math.max(1, Math.min(3, CONCURRENCY)));

  const results = [];
  let completed = 0;
  const promises = companies.map((company, index) => limit(async () => {
    const result = await auditCompany(company, index + 1, companies.length);
    results[index] = result;
    completed += 1;
    console.log(`[Audit] Completed ${completed}/${companies.length} (${result.name})`);
  }));

  await Promise.allSettled(promises);

  const summary = buildSummary(results);
  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    companies: results,
  };

  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(MARKDOWN_REPORT_PATH, buildMarkdown(results, summary));

  console.log(`\nAudit complete. Report written to ${JSON_REPORT_PATH}`);
  console.log(`Markdown report written to ${MARKDOWN_REPORT_PATH}`);
  console.log(JSON.stringify({
    totalActiveCompanies: summary.totalActiveCompanies,
    companiesWithJobs: summary.companiesWithJobs,
    companiesRecoveredByFallback: summary.companiesRecoveredByFallback,
    companiesStillZeroAfterFallback: summary.companiesStillZeroAfterFallback,
    companiesSkippedByAntiBot: summary.companiesSkippedByAntiBot,
    companiesWithScrapeErrors: summary.companiesWithScrapeErrors,
    companiesWithSdeJobs: summary.companiesWithSdeJobs,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
