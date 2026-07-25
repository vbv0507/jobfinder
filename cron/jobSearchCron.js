const cron = require("node-cron");
const chalk = require("chalk");
const { withLogContext } = require("../utils/logger");

const Company = require("../models/Company");
const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");
const CandidateProfile = require("../models/CandidateProfile");
const PipelineLock = require("../models/PipelineLock");

const AdapterFactory = require("../services/ats/AdapterFactory");
const { applyJobFilters } = require("../services/pipeline/validationService");
const { sendMatchedJobEmail } = require("../services/emailService");
const { saveTrainingSample } = require("../services/trainingDatasetService");

const pipelineState = require("../services/pipelineState");
const crypto = require("crypto");
const { saveRawJob, saveMatchedJob, hasExistingMatch, saveSearchLog } = require("../services/pipeline/storageService");
const { getActiveProfile, analyseWithGemini } = require("../services/pipeline/aiEvaluationService");
const { discoverEndpoint } = require('../services/ats/discoveryService');
const socketService = require("../services/socketService");

const MAX_JOBS_PER_COMPANY = Number(process.env.MAX_JOBS_PER_COMPANY || 10);

const runSearch = async (triggerSource = "Unknown", forceRefresh = false) => {
  const startedAt = new Date();
  const runnerName = triggerSource;

  // Ensure the lock document exists
  await PipelineLock.updateOne(
    { lockId: "global_pipeline_lock" },
    { $setOnInsert: { status: "Idle", startedAt: null, runner: "none", expiresAt: null } },
    { upsert: true }
  );

  // Try to acquire the lock
  const lock = await PipelineLock.findOneAndUpdate(
    {
      lockId: "global_pipeline_lock",
      $or: [
        { status: "Idle" },
        { expiresAt: { $lt: startedAt } }
      ]
    },
    {
      $set: {
        status: "Running",
        startedAt: startedAt,
        runner: runnerName,
        expiresAt: new Date(startedAt.getTime() + 30 * 60 * 1000)
      }
    },
    { returnDocument: "after" }
  );

  const pipelineId = `${startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${runnerName.replace(/\s+/g, '').toUpperCase()}`;

  if (!lock) {
    const currentLock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
    const owner = currentLock ? currentLock.runner : "Unknown";
    console.log(chalk.yellow(`[Pipeline] Another execution is already running. Skipping. Owner: ${owner}`));
    
    if (runnerName !== "Manual") {
      await SearchLog.create({
        pipelineId,
        triggerSource: runnerName,
        status: "Skipped",
        skipReason: "Distributed lock already active",
        currentRunner: owner,
        expectedUnlock: currentLock ? currentLock.expiresAt : null,
        startedAt: startedAt,
        completedAt: new Date(),
        durationMs: new Date() - startedAt
      });
    }
    
    return { 
      skipped: true, 
      reason: "Already running",
      runner: owner,
      startedAt: currentLock ? currentLock.startedAt : null,
      expiresAt: currentLock ? currentLock.expiresAt : null
    };
  }

  console.log(chalk.blue(`[Pipeline] Lock Acquired. Owner: ${runnerName}. Expires: ${lock.expiresAt.toISOString()}`));

  let pipelineLog = null;
  pipelineState.start(pipelineId);

  try {
    pipelineLog = await SearchLog.create({
      pipelineId,
      triggerSource: runnerName,
      status: "Running",
      startedAt: startedAt
    });

  console.log(chalk.cyan(`[Pipeline] ID: ${pipelineId} | Trigger source: ${runnerName}. Start time: ${startedAt.toISOString()}`));

    const stats = {
      totalCompanies: 0,
      cachedCompanies: 0,
      companiesScanned: 0,
      successfulCompanies: 0,
      failedCompanies: 0,
    jobsFound: 0,
    jobsSaved: 0,
    jobsMatched: 0,
    newJobs: 0,
    companiesWithJobs: 0,
    companiesWithoutJobs: 0,
    parserOutdated: 0,
    atsChanged: 0,
    httpFailed: 0,
    blocked: 0,
    retriedSuccessfully: 0,
    jobsScraped: 0,
    jobsEvaluated: 0,
    duplicates: 0,
    validationDrops: 0,
    validationDropsByReason: {},
    totalSaveTime: 0,
    retrySuccess: 0,
    jobsArchived: 0,
    jobsRefreshed: 0,
    duplicatePreventionCount: 0,
    totalEvaluationTimeMs: 0,
    totalMetadataRefreshTimeMs: 0,
    aiEvaluations: 0,
    geminiCount: 0,
    geminiSuccess: 0,
    geminiFailed: 0,
    geminiFallbacks: 0,
    groqCount: 0,
    groqSuccess: 0,
    groqFailed: 0,
    groqFallbacks: 0,
    zaiCount: 0,
    zaiSuccess: 0,
    zaiFailed: 0,
    zaiFallbacks: 0,
    localCount: 0,
    localSuccess: 0,
  };
  const aiState = {
    gemini: { available: true, reason: null, disabledAt: null, requests: 0, success: 0, failed: 0 },
    groq: { available: true, reason: null, disabledAt: null, requests: 0, success: 0, failed: 0 },
    zai: { available: true, reason: null, disabledAt: null, requests: 0, success: 0, failed: 0 },
    local: { requests: 0, success: 0, failed: 0 },
    calls: 0
  };

  pipelineState.geminiStatus = "Ready";
  pipelineState.geminiReason = null;
  pipelineState.geminiRequests = 0;
  pipelineState.geminiFallbacks = 0;
  pipelineState.geminiDisabledAt = null;
  
  pipelineState.groqStatus = "Ready";
  pipelineState.groqReason = null;
  pipelineState.groqRequests = 0;
  pipelineState.groqFallbacks = 0;
  pipelineState.groqDisabledAt = null;
  
  pipelineState.zaiStatus = "Ready";
  pipelineState.zaiReason = null;
  pipelineState.zaiRequests = 0;
  pipelineState.zaiFallbacks = 0;
  pipelineState.zaiDisabledAt = null;
  
  pipelineState.localRequests = 0;

  pipelineState.reset();
  pipelineState.running = true;
  pipelineState.owner = runnerName;
  pipelineState.startedAt = startedAt;
  pipelineState.status = "Running";
  pipelineState.pipelineId = pipelineId;
  pipelineState.jobsScraped = 0;
  pipelineState.jobsEvaluated = 0;
  pipelineState.lastRunTime = startedAt;
  
  pipelineState.transition("DISCOVERING", "Loading Companies");
  pipelineState.addLog("INFO", "Loading companies from database...");

  console.log(chalk.bgBlue.white.bold("\n================================="));
  console.log(chalk.bgBlue.white.bold(" Job Search Started...           "));
  console.log(chalk.bgBlue.white.bold("=================================\n"));

  const errors = [];

    const companies = await Company.find({ active: true });
    const profile = await getActiveProfile();

    stats.totalCompanies = companies.length;

    const pipelineSummary = [];
    const companyDiagnostics = [];
    const companyTimelines = {}; // Populated by cached below, and workers later

    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const companiesToScrape = companies.filter(company => {
      if (!forceRefresh && company.lastScrapedAt && (Date.now() - new Date(company.lastScrapedAt).getTime()) < TWELVE_HOURS) {
        console.log(chalk.gray(`[Cache] Skipping ${company.name}, scraped within last 12 hours.`));
        stats.cachedCompanies++;
        
        // Write timeline events for cached companies so they don't disappear from observability
        const timeline = [
            { stage: 'Initialization', severity: 'SUCCESS', message: 'Pipeline lock acquired', timestamp: new Date() },
            { stage: 'Cache Check', severity: 'SUCCESS', message: 'Cache Hit - Skipped (TTL Active)', timestamp: new Date() }
        ];
        companyTimelines[company.name] = timeline;
        
        // Update the database to reflect this latest timeline without changing lastScrapedAt
        Company.updateOne(
            { _id: company._id },
            { $set: { latestExecutionTimeline: timeline } }
        ).catch(err => console.error(`Failed to save timeline for cached company ${company.name}:`, err.message));
        
        return false;
      }
      return true;
    });

    stats.companiesScanned = companiesToScrape.length;

    // Use p-limit for concurrent scraping (max 8 companies at a time)
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(8);

    let completedCompanies = 0;
    stats.workersFailed = 0;

    const results = await Promise.allSettled(companiesToScrape.map((company) => limit(async () => {
      
      if (pipelineState.cancelRequested) {
        logEvent("Cancellation", "WARN", "Aborted by user before saving");
        return;
      }

      pipelineState.activeCompanies.push(company.name);
      pipelineState.currentCompany = company.name;
      pipelineState.currentATS = company.ats;
      pipelineState.currentURL = company.careerPageUrl || company.careersUrl;
      pipelineState.progress = `${Math.floor(((completedCompanies + 1) / stats.companiesScanned) * 100)}%`;
      pipelineState.companyIndex = completedCompanies + 1;
      pipelineState.totalCompanies = stats.companiesScanned;
      pipelineState.updateElapsed();
      pipelineState.transition("SCRAPING", `Scraping ${company.name}`);

      pipelineState.addTimeline("Scraping", company.name, `Started scraping ${company.name}`, "INFO");
      pipelineState.addLog("INFO", `Started scraping ${company.name} [${company.ats || 'Unknown ATS'}]`);

      let attempt = 0;
      const companyTimeline = [];
      const logEvent = (stage, severity, message, httpCode = null, durationMs = null) => {
          companyTimeline.push({ timestamp: new Date(), stage, severity, message, httpCode, durationMs, retryCount: attempt });
      };

      let companyJobsFound = 0;
      let companyJobsMatched = 0;
      let companyJobsSaved = 0;
      let companyAiEvaluated = 0;
      let companyDuplicates = 0;
      let companyStatus = "success";
      let companyErrorMsg = null;
      let companyErrors = 0;
      let companyMetrics = {};
      const companyStartTime = Date.now();

      await withLogContext({ pipelineId, company: company.name, stage: "Fetching Jobs" }, async () => {
      logEvent("Initialization", "INFO", "Started processing company");

      let jobs = [];
      let droppedJobs = [];
      let validJobs = [];
      
      let maxAttempts = 2; // For auto-discovery retry
      
      while (attempt < maxAttempts) {
          attempt++;
          try {
            const adapter = AdapterFactory.getAdapter(company);
            companyMetrics.parserUsed = adapter.constructor.name;
            companyMetrics.parserName = adapter.parserName;
            companyMetrics.parserVersion = adapter.parserVersion;
            
            jobs = await adapter.searchJobs();
            
            // Append scraper internal trail if present
            if (adapter.trail) {
                adapter.trail.forEach(t => logEvent(t.stage, t.severity, t.message, t.httpCode, t.durationMs));
            }
            
            logEvent("Scraping", "SUCCESS", `Parsed ${jobs.length} raw jobs`);
            companyMetrics.jobsScraped = jobs.length;
            companyMetrics.jobsParsed = jobs.length;
            
            droppedJobs = adapter.droppedJobs || [];
            companyMetrics.jobsValidated = jobs.length;

            validJobs = applyJobFilters(jobs, company, droppedJobs);
            
            droppedJobs.forEach(dj => {
                logEvent("Validation", "WARN", `Rejected: ${dj.jobTitle} -> ${dj.reason}`);
            });
            logEvent("Validation", "SUCCESS", `Passed validation: ${validJobs.length} jobs`);
            
            companyStatus = "success";
            break; // Success, break retry loop
          } catch (error) {
              if (error.trail) {
                  error.trail.forEach(t => logEvent(t.stage, t.severity, t.message, t.httpCode, t.durationMs));
              }
              logEvent("Scraping", "ERROR", error.message, error.response?.status);
              
              const needsDiscovery = ['404', '410', 'INVALID_ENDPOINT', 'OUTDATED_ENDPOINT'].includes(error.type) || error.message.includes('API URL missing') || error.message.includes('Page not found');
              
              if (needsDiscovery && attempt < maxAttempts) {
                  console.log(chalk.yellow(`[Self-Healing] ${company.name} failed with ${error.type || 'Missing Endpoint'}. Attempting auto-discovery...`));
                  logEvent("Self-Healing", "WARN", `Triggering self-healing due to ${error.type || 'Missing Endpoint'}`);
                  const discovery = await discoverEndpoint(company);
                  
                  if (discovery.trail) {
                      discovery.trail.forEach(t => logEvent(t.stage, t.severity, t.message, t.httpCode, t.durationMs));
                  }
                  
                  if (discovery.success) {
                      console.log(chalk.green(`[Self-Healing] Successfully discovered new endpoint for ${company.name}. Retrying...`));
                      continue; // Retry with new config
                  } else {
                      const atsName = (company.ats || 'custom').toLowerCase();
                      const hasDedicatedParser = ['greenhouse', 'workday', 'lever', 'smartrecruiters', 'ashby', 'oracle', 'icims'].includes(atsName);
                      
                      if (hasDedicatedParser) {
                          console.log(chalk.red(`[Self-Healing] Auto-discovery failed for ${company.name}. Dedicated parser required. No fallback allowed.`));
                          error.type = 'INVALID_ENDPOINT';
                          error.discoveryReason = discovery.reason;
                          attempt = maxAttempts; // Force exit
                          continue;
                      } else {
                          console.log(chalk.red(`[Self-Healing] Auto-discovery failed for ${company.name}. Falling back to Universal Parser.`));
                          error.discoveryReason = discovery.reason;
                          company.adapter = 'LightweightHtmlAdapter';
                          continue;
                      }
                  }
              }
              
              if (attempt >= maxAttempts && !['INVALID_ENDPOINT'].includes(error.type)) {
                  error.type = 'DISCOVERY_FAILED';
                  if (error.discoveryReason) {
                      error.message = `Auto-Discovery Error: ${error.discoveryReason} | Fallback Error: ${error.message}`;
                  }
              }
              
              // Strict Failure Classification
              let finalErrorType = error.type || 'UNKNOWN';
              const errStr = error.message ? error.message.toLowerCase() : "";
              if (finalErrorType === 'UNKNOWN' || finalErrorType === 'Error' || finalErrorType === 'DISCOVERY_FAILED') {
                 if (errStr.includes('header') || errStr.includes('token')) finalErrorType = 'INVALID_HEADERS';
                 else if (errStr.includes('parser') || errStr.includes('parsing') || errStr.includes('json') || errStr.includes('cannot read properties')) finalErrorType = 'PARSER_ERROR';
                 else if (errStr.includes('payload')) finalErrorType = 'INVALID_PAYLOAD';
                 else if (errStr.includes('login') || errStr.includes('unauthorized') || errStr.includes('401') || errStr.includes('auth')) finalErrorType = 'AUTH_REQUIRED';
                 else if (errStr.includes('cookie')) finalErrorType = 'COOKIE_REQUIRED';
                 else if (errStr.includes('csrf')) finalErrorType = 'CSRF_REQUIRED';
                 else if (errStr.includes('429') || errStr.includes('rate limit')) finalErrorType = 'RATE_LIMITED';
                 else if (errStr.includes('cloudflare') || errStr.includes('incapsula') || errStr.includes('captcha')) finalErrorType = 'CLOUDFLARE';
                 else if (errStr.includes('network') || errStr.includes('timeout') || errStr.includes('econn') || errStr.includes('socket')) finalErrorType = 'NETWORK_ERROR';
                 else if (errStr.includes('validation')) finalErrorType = 'VALIDATION_ERROR';
                 else if (errStr.includes('empty')) finalErrorType = 'EMPTY_RESPONSE';
                 else if (errStr.includes('404') || errStr.includes('not found')) finalErrorType = 'INVALID_ENDPOINT';
              }
              
              if (finalErrorType === '404' || finalErrorType === '410' || finalErrorType === 'PARSER_OUTDATED') finalErrorType = 'INVALID_ENDPOINT';
              
              companyStatus = "failed";
              companyErrorMsg = finalErrorType;

              if (finalErrorType === 'OUTDATED_ENDPOINT' || finalErrorType === 'DISCOVERY_FAILED') stats.parserOutdated++;
              else if (finalErrorType === 'ATS_CHANGED') stats.atsChanged++;
              else if (finalErrorType === 'BLOCKED' || finalErrorType === 'CLOUDFLARE') stats.blocked++;
              else if (['LOGIN_REQUIRED', 'RATE_LIMITED', 'NETWORK_ERROR'].includes(finalErrorType)) stats.httpFailed++;

              stats.failedCompanies++;
              errors.push({
                company: company.name,
                message: error.message,
              });
              company.lastFailure = new Date();
              company.failureReason = companyErrorMsg;
              break; // Unrecoverable or already retried
          }
      }

      if (companyStatus !== 'failed') {
          if (stats) {
             stats.jobsScraped += companyMetrics.jobsScraped;
             stats.validationDrops += droppedJobs.length;
             
             for (const drop of droppedJobs) {
               const r = drop.reason || 'Unknown';
               stats.validationDropsByReason[r] = (stats.validationDropsByReason[r] || 0) + 1;
             }
          }

          companyJobsFound = validJobs.length;
          stats.jobsFound += validJobs.length;
          pipelineState.jobsScraped = stats.jobsFound;

          const jobsToProcess = validJobs.slice(0, MAX_JOBS_PER_COMPANY);

          for (const job of jobsToProcess) {
            await withLogContext({ jobUrl: job.applyLink }, async () => {
            const rawJob = await saveRawJob(company, job, stats);
            if (!rawJob) return; // Fix validation pipeline crash
            
            companyJobsSaved++;
            console.log(chalk.gray(`Saved Job: ${job.title} (${company.name})`));

            try {
              if (rawJob.aiMatched || await hasExistingMatch(rawJob)) {
                console.log(chalk.gray(`[Dedup] Existing job detected for ${job.title} (${company.name})`));
                
                companyDuplicates++;
                stats.duplicates++;
                const startRefresh = Date.now();
                await MatchedJob.findOneAndUpdate(
                  { rawJob: rawJob._id },
                  { $set: { 
                      role: job.title,
                      location: job.location,
                      applyLink: job.applyLink,
                      lastScrapedAt: new Date(),
                      lastMetadataUpdate: new Date(),
                      isActive: true,
                      jobStatus: "Open"
                   } }
                );
                stats.totalMetadataRefreshTimeMs += (Date.now() - startRefresh);
                stats.jobsRefreshed++;
                stats.duplicatePreventionCount++;
                return;
              }

              pipelineState.currentStage = "AI Evaluation";
              const evalStart = Date.now();
              let providerContext = "Gemini";
              const result = await withLogContext({ stage: "AI Evaluation", provider: "AI_Engine" }, async () => {
                  return await analyseWithGemini(job, profile, aiState);
              });
              if (result.analysis && result.analysis.evaluationTimeMs) {
                  stats.totalEvaluationTimeMs += result.analysis.evaluationTimeMs;
              }
              
              companyAiEvaluated++;
              stats.aiEvaluations++;
              if (result.analysis && result.analysis.provider) {
                  pipelineState.currentAiProvider = result.analysis.provider.toLowerCase();
              } else if (!result.skipped) {
                  pipelineState.currentAiProvider = 'gemini';
              }
              pipelineState.jobsEvaluated++;

              if (result.skipped) {
                console.log(chalk.gray(`Skipped Gemini analysis for ${job.title}: ${result.reason}`));
                logEvent("AI Evaluation", "INFO", `Skipped ${job.title}: ${result.reason}`);
                return;
              }
              
              logEvent("AI Evaluation", "SUCCESS", `Evaluated ${job.title} using ${pipelineState.currentAiProvider}: Score ${result.analysis?.score}`);

              pipelineState.currentStage = "Saving Results";
              
              // ML Dataset Collection
              if (result.analysis) {
                 try {
                     await saveTrainingSample(job, company, result.analysis, pipelineId, triggerSource);
                 } catch (err) {
                     console.log(chalk.red(`[TrainingDataset] Async save error: ${err.message}`));
                 }
              }

              const { matched, isDuplicate } = await saveMatchedJob(
                rawJob,
                company,
                job,
                result.analysis,
              );

              if (matched) {
                stats.jobsMatched++;
                stats.newJobs++;
                companyJobsMatched++;
                pipelineState.jobsMatched++;
                
                const providerStr = result.analysis.provider ? result.analysis.provider.charAt(0).toUpperCase() + result.analysis.provider.slice(1) : "Gemini";
                stats.aiProviderUsed = providerStr;
                
                const providerChainStr = result.analysis.providerChain ? result.analysis.providerChain.join(' -> ') : providerStr;
                console.log(chalk.green(`Matched (Score: ${result.analysis.score}) | Email: ${isDuplicate ? 'Skipped' : 'Sent'}`));
                
                if (!isDuplicate) {
                  try {
                    await sendMatchedJobEmail({
                      company,
                      job,
                      analysis: result.analysis,
                      pipelineId,
                      isDuplicate: false
                    });
                  } catch (emailError) {}
                }
              }
            } catch (error) {
              companyErrors++;
              errors.push({
                company: company.name,
                jobTitle: job.title,
                message: error.message,
              });
              console.error(chalk.red(`[Evaluation Error] ${error.message}`));
            }
            }); // End of job withLogContext
          }

          if (companyErrors > 0 && validJobs.length > 0) {
            companyStatus = "partial";
            companyErrorMsg = `${companyErrors} jobs failed analysis`;
            stats.partialCompanies = (stats.partialCompanies || 0) + 1;
          } else if (companyErrors > 0 && validJobs.length === 0) {
            companyStatus = "failed";
            companyErrorMsg = `All jobs failed analysis`;
            stats.failedCompanies++;
          } else {
            stats.successfulCompanies++;
          }
          
          // Closed Job Detection
          if (validJobs.length > 0) {
              stats.companiesWithJobs++;
              const crypto = require("crypto");
              const activeJobIds = validJobs.map(j => {
                  let jId = j.jobId;
                  if (!jId || jId === "unknown") jId = crypto.createHash("md5").update(j.applyLink || "").digest("hex");
                  return jId;
              });
              
              const missingRawJobs = await RawJob.find({ company: company._id, jobId: { $nin: activeJobIds } }).select("_id");
              const missingRawJobIds = missingRawJobs.map(r => r._id);
              
              if (missingRawJobIds.length > 0) {
                  const archiveResult = await MatchedJob.updateMany(
                      { rawJob: { $in: missingRawJobIds }, isActive: { $ne: false } },
                      { $set: { isActive: false, jobStatus: "Closed", closedAt: new Date() } }
                  );
                  if (archiveResult.modifiedCount > 0) {
                      console.log(chalk.yellow(`[Archive] Job marked Closed: ${archiveResult.modifiedCount} jobs for ${company.name}`));
                      stats.jobsArchived += archiveResult.modifiedCount;
                  }
              }
          } else {
              stats.companiesWithoutJobs++;
          }
      } // End if not failed
        
      company.lastSuccess = new Date();
      company.successRuns = (company.successRuns || 0) + 1;
      company.retryCount = stats.retrySuccess; 
      company.jobsSaved += companyJobsSaved;
      company.jobsEvaluated += companyAiEvaluated;
        
      company.totalRuns = (company.totalRuns || 0) + 1;
      company.totalTimeSpent = (company.totalTimeSpent || 0) + (Date.now() - companyStartTime);
      company.avgResponseTime = company.totalTimeSpent / company.totalRuns;
      company.successPercent = (company.successRuns / company.totalRuns) * 100;
      company.lastScrapedAt = new Date();

      // Advanced Health Scoring
      let score = 100;
      if (company.successPercent < 90) score -= (100 - company.successPercent) * 0.5;
      if (stats.retrySuccess > 0) score -= (stats.retrySuccess * 2);
      if (companyStatus === 'failed') {
         if (companyErrorMsg && companyErrorMsg.includes('PARSER')) score -= 20;
         if (companyErrorMsg && companyErrorMsg.includes('ATS')) score -= 30;
         score -= 10;
      }
      company.healthScore = Math.max(0, Math.min(100, Math.round(score)));

      const gradeColor = score >= 90 ? chalk.green : (score >= 70 ? chalk.blue : (score >= 50 ? chalk.yellow : (score >= 30 ? chalk.red : chalk.bgRed.white)));
      const grade = score >= 90 ? 'Healthy' : (score >= 70 ? 'Good' : (score >= 50 ? 'Warning' : (score >= 30 ? 'Critical' : 'Broken')));
      
      console.log(`\n` + chalk.cyan(`==================================================`));
      console.log(chalk.bold.white(`${company.name}`));
      console.log(chalk.gray(`Detected ATS: ${company.scraperConfig?.ats || 'unknown'}`));
      console.log(chalk.gray(`Parser: ${companyMetrics.parserName || 'Unknown'} v${companyMetrics.parserVersion || '1.0'}`));
      console.log(companyStatus === 'failed' ? chalk.red(`HTTP: ${companyErrorMsg}`) : chalk.green(`HTTP: 200 OK`));
      console.log(chalk.white(`Jobs Found: `) + chalk.yellow(`${companyMetrics.jobsScraped || 0}`));
      console.log(chalk.white(`Validation Passed: `) + chalk.green(`${companyJobsFound}`));
      console.log(chalk.white(`Saved: `) + chalk.cyan(`${companyJobsSaved}`));
      console.log(chalk.white(`Duplicates: `) + chalk.gray(`${companyDuplicates}`));
      console.log(chalk.white(`AI Evaluated: `) + chalk.magenta(`${companyAiEvaluated}`));
      console.log(chalk.white(`Matched: `) + chalk.green.bold(`${companyJobsMatched}`));
      console.log(chalk.white(`Duration: `) + `${Date.now() - companyStartTime}ms`);
      console.log(chalk.white(`Health: `) + gradeColor(grade));
      if (companyStatus !== 'success') {
         console.log(chalk.red(`Errors: ${companyErrorMsg}`));
      }
      console.log(chalk.cyan(`==================================================`) + `\n`);

      if (companyStatus === "success" || companyStatus === "partial") {
          pipelineSummary.push(chalk.green(`✓ ${company.name} (${companyJobsFound} jobs) - ${grade}`));
      } else {
          pipelineSummary.push(chalk.red(`✗ ${company.name} (${companyErrorMsg}) - ${grade}`));
      }
      
      companyDiagnostics.push({
          company: company.name,
          atsDetected: company.scraperConfig?.ats || 'unknown',
          careerUrl: company.careerUrl,
          httpStatus: companyStatus === 'failed' ? 'ERROR' : '200',
          scraperUsed: companyMetrics.parserUsed || 'unknown',
          retryCount: stats.retrySuccess,
          jobsScraped: companyMetrics.jobsScraped || 0,
          jobsReturnedAfterParsing: companyJobsFound,
          jobsValidated: companyMetrics.jobsValidated || 0,
          jobsSaved: companyJobsSaved,
          jobsEvaluated: companyAiEvaluated,
          finalStatus: companyStatus,
          failureReason: companyErrorMsg || null
      });

      }); // End of company withLogContext

      completedCompanies++;
      pipelineState.progress = `${completedCompanies} / ${stats.companiesScanned} companies`;
      pipelineState.activeCompanies = pipelineState.activeCompanies.filter(c => c !== company.name);
      pipelineState.successfulCompanies = stats.successfulCompanies;
      pipelineState.failedCompanies = stats.failedCompanies;
      pipelineState.cachedCompanies = stats.cachedCompanies;
      pipelineState.jobsFound = stats.jobsFound;
      pipelineState.jobsSaved = stats.jobsSaved;
      pipelineState.matchedJobs = stats.jobsMatched;
      pipelineState.aiEvaluated = stats.aiEvaluations;
      pipelineState.updateElapsed();

      company.jobsFound = companyJobsFound;
      company.matchedJobs = companyJobsMatched;
      company.lastScan = new Date();
      company.lastRunStatus = companyStatus;
      if (companyErrorMsg) company.lastError = companyErrorMsg;
      company.lastHttpStatus = companyStatus === 'failed' ? 'ERROR' : '200';
      if (company.scraperConfig?.ats) company.lastAts = company.scraperConfig.ats;
      company.lastParser = companyMetrics.parserUsed || 'unknown';

      // Historical Analytics
      if (!company.runHistory) company.runHistory = [];
      company.runHistory.unshift({
         date: new Date(),
         status: companyStatus,
         jobsFound: companyJobsFound,
         responseTime: Date.now() - companyStartTime,
         parserVersion: companyMetrics.parserVersion || '1.0.0',
         parserName: companyMetrics.parserName || 'unknown',
         error: companyErrorMsg
      });
      if (company.runHistory.length > 30) {
         company.runHistory.pop();
      }
      
      logEvent("Finalization", companyStatus === "success" ? "SUCCESS" : (companyStatus === "partial" ? "WARN" : "ERROR"), `Completed run with status: ${companyStatus}`);
      company.latestExecutionTimeline = companyTimeline;
      companyTimelines[company.name] = companyTimeline;

      try {
          await company.save();
          const updatedCompany = company.toObject();
          const { getCompanyLogo } = require("../utils/companyBranding");
          socketService.broadcast("company:update", {
              ...updatedCompany,
              logoUrl: updatedCompany.logo || getCompanyLogo(updatedCompany.name)
          });
          socketService.emitCompanySnapshot().catch(err => console.error("[Socket] Failed to emit companies:update:", err.message));
      } catch (saveError) {
          console.error(chalk.bgRed.white(`[Database Error] Failed to save company ${company.name}: ${saveError.message}`));
          logEvent("Finalization", "ERROR", `Database Save Failed: ${saveError.message}`);
          
          if (companyStatus !== 'failed') {
              stats.failedCompanies++;
              stats.successfulCompanies = Math.max(0, stats.successfulCompanies - 1);
              pipelineSummary.push(chalk.red(`✗ ${company.name} (DB Save Error) - Broken`));
          }
      }
    })));
    
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const company = companiesToScrape[index];
            console.error(chalk.bgRed.white(`\n[Worker Rejected] ${company.name}`));
            console.error(chalk.red(result.reason && result.reason.stack ? result.reason.stack : result.reason));
            
            stats.failedCompanies++;
            stats.workersFailed++;
            pipelineSummary.push(chalk.red(`✗ ${company.name} (Worker Crashed) - Broken`));
            
            errors.push({
                company: company.name,
                message: `Worker Crashed: ${result.reason?.message || result.reason}`
            });
        }
    });

    stats.geminiCount = aiState.gemini.requests || 0;
    stats.geminiSuccess = aiState.gemini.success || 0;
    stats.geminiFailed = aiState.gemini.failed || 0;
    stats.geminiFallbacks = aiState.geminiFallbacks || 0;
    
    stats.groqCount = aiState.groq.requests || 0;
    stats.groqSuccess = aiState.groq.success || 0;
    stats.groqFailed = aiState.groq.failed || 0;
    stats.groqFallbacks = aiState.groqFallbacks || 0;
    
    stats.zaiCount = aiState.zai.requests || 0;
    stats.zaiSuccess = aiState.zai.success || 0;
    stats.zaiFailed = aiState.zai.failed || 0;
    stats.zaiFallbacks = aiState.zaiFallbacks || 0;
    
    stats.localCount = aiState.local.requests || 0;
    stats.localSuccess = aiState.local.success || 0;

    const savedLog = await saveSearchLog(pipelineLog._id, startedAt, stats, errors);
    if (savedLog) {
        await SearchLog.findByIdAndUpdate(pipelineLog._id, { $set: { companyTimelines: companyTimelines } });
    }

    console.log(`\n` + chalk.bgBlue.white.bold(` ================================================== `));
    console.log(chalk.bgBlue.white.bold(` PIPELINE SUMMARY                                   `));
    console.log(chalk.bgBlue.white.bold(` ================================================== `));
    pipelineSummary.forEach(log => console.log(log));
    console.log(chalk.cyan(`==================================================`));
    console.log(chalk.cyan(`Job Search Completed in ${stats.totalEvaluationTimeMs ? Math.round(stats.totalEvaluationTimeMs/1000) : Math.round((Date.now() - startedAt)/1000)}s`));
  console.log(chalk.cyan(`Total Companies: ${stats.totalCompanies}`));
  console.log(chalk.cyan(`Cached/Skipped: ${stats.cachedCompanies}`));
  console.log(chalk.cyan(`Actually Scraped: ${stats.companiesScanned}`));
  console.log(chalk.cyan(`Healthy: ${stats.successfulCompanies}`));
  console.log(chalk.cyan(`Failed: ${stats.failedCompanies}`));
  console.log(chalk.cyan(`Jobs Scraped (Raw): ${stats.jobsFound}`));
  console.log(chalk.cyan(`Jobs Saved (Matched): ${stats.jobsSaved}`));
    console.log(chalk.gray(`Duplicates: `) + stats.duplicates);
    console.log(chalk.gray(`Matched Jobs: `) + stats.jobsMatched);
    console.log(chalk.gray(`AI Evaluated: `) + stats.aiEvaluations);
    if (stats.workersFailed > 0) {
        console.log(chalk.red.bold(`Workers Failed: ${stats.workersFailed}`));
    }
    
    console.log(chalk.yellow(`\nDiagnostics:`));
    console.log(`Parser Outdated: ${stats.parserOutdated}`);
    console.log(`ATS Changed: ${stats.atsChanged}`);
    console.log(`HTTP Failed: ${stats.httpFailed}`);
    console.log(`Blocked: ${stats.blocked}`);
    
    console.log(chalk.magenta(`\nValidation Drops: ${stats.validationDrops}`));
    const sortedDrops = Object.entries(stats.validationDropsByReason).sort((a,b) => b[1] - a[1]);
    for (const [reason, count] of sortedDrops) {
       console.log(`  - ${reason}: ${count}`);
    }
    console.log(chalk.bgBlue.white.bold(` ================================================== `) + `\n`);
    
    try {
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(__dirname, '..', 'evidence.json'), JSON.stringify(companyDiagnostics, null, 2));
        console.log(chalk.green("Runtime evidence saved to evidence.json"));
    } catch (e) {
        console.error(chalk.red("Failed to write evidence.json: " + e.message));
    }
    
    if (errors.length > 0) {
      pipelineState.finish();
      pipelineState.statusText = `Completed with ${errors.length} warnings.`;
    } else {
      pipelineState.finish();
    }
  } catch (error) {
    console.error(chalk.bgRed.white(`Cron Error: ${error.message}`));

    pipelineState.fail(error.message);

    if (pipelineLog) {
      await SearchLog.findByIdAndUpdate(pipelineLog._id, {
        completedAt: new Date(),
        durationMs: new Date() - startedAt,
        status: "Failed",
        message: `Failed: ${error.message}`,
        errorType: error.name || "Error",
        stackTrace: error.stack,
        companyBeingProcessed: pipelineState.currentCompany,
        currentStage: pipelineState.currentStage,
        companiesScanned: stats?.companiesScanned || 0,
        successfulCompanies: stats?.successfulCompanies || 0,
        failedCompanies: stats?.failedCompanies || 0,
        totalJobs: stats?.jobsFound || 0,
        jobsMatched: stats?.jobsMatched || 0,
        errorDetails: [{ message: error.message }],
      });
    }
  } finally {
    const endTime = new Date();
    const duration = endTime - startedAt;
    console.log(chalk.gray(`[Pipeline] End time: ${endTime.toISOString()}. Duration: ${duration}ms`));
    
    // Strict pipeline lock release
    if (pipelineState.running) {
       if (pipelineState.cancelRequested) {
           pipelineState.markCancelled();
       } else {
           pipelineState.finish();
       }
    }
    
    await PipelineLock.updateOne(
      { lockId: "global_pipeline_lock" },
      { $set: { status: "Idle", runner: "none", expiresAt: null } }
    ).catch(err => console.error("Error releasing pipeline lock:", err.message));
    
    console.log(chalk.blue(`[Pipeline] Lock Released. Owner: ${runnerName}.`));
  }
};

const schedule = "0 2 * * *";
const cronTask = cron.schedule(schedule, () => runSearch("Azure Cron"));
pipelineState.nextRunTime = "Scheduled for 02:00 AM daily";

module.exports = runSearch;
module.exports.runSearch = runSearch;
