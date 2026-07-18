const cron = require("node-cron");

const Company = require("../models/Company");
const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");
const CandidateProfile = require("../models/CandidateProfile");
const TelegramChannel = require("../models/TelegramChannel");
const PipelineLock = require("../models/PipelineLock");

const fallbackProfile = require("../profile");

const { scrapeCompanyJobs } = require("../services/scraperService");
const { evaluateJob } = require("../services/geminiService");
const { sendMatchedJobEmail } = require("../services/emailService");
const { saveTrainingSample } = require("../services/trainingDatasetService");
const { classifyDomain } = require("../utils/domains");
const pipelineState = require("../services/pipelineState");
const crypto = require("crypto");

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);
const MAX_JOBS_PER_COMPANY = Number(process.env.MAX_JOBS_PER_COMPANY || 10);
const STRICT_LOCATION_MATCH = process.env.STRICT_LOCATION_MATCH !== "false";

const getJobText = (job) =>
  [job.title, job.location, job.experience, job.description, job.employmentType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const hasEntryLevelSignal = (text) =>
  /\b(intern|internship|fresher|new grad|entry level|campus|trainee|junior)\b|0\s*-\s*1|0\s*to\s*1/i.test(
    text,
  );



const getSkipReason = (job, profile) => {
  const text = getJobText(job);
  const preferredLocations = profile.preferredLocations || [];
  const preferredRoles = profile.preferredRoles || [];

  const locationMatches =
    !STRICT_LOCATION_MATCH ||
    preferredLocations.length === 0 ||
    preferredLocations.some((location) => {
      const value = location.toLowerCase();
      return (
        text.includes(value) ||
        (value === "india" && text.includes("ind")) ||
        (value === "remote" && text.includes("remote"))
      );
    });

  if (!locationMatches) {
    return "location not preferred";
  }

  const roleMatches = preferredRoles.some((role) =>
    text.includes(role.toLowerCase()),
  );
  const technicalRoleMatches =
    /\b(software|sde|backend|front.?end|full.?stack|developer|engineer|node\.?js|express|mongodb|javascript|rest api|api developer)\b/i.test(
      text,
    );
  const fresherRoleMatches = hasEntryLevelSignal(text);

  if (!roleMatches && !technicalRoleMatches && !fresherRoleMatches) {
    return "role not aligned with profile";
  }

  const jobDomain = classifyDomain(text);
  const excludedDomains = (profile.excludedDomains || []).map(d => d.toUpperCase());
  
  if (excludedDomains.includes(jobDomain)) {
    return `domain mismatch: classified as ${jobDomain}`;
  }

  const hasSeniorKeyword =
    /\b(senior|sr\.?|lead|principal|manager|director|architect|staff)\b/i.test(
      text,
    );
  const hasTwoPlusYears = [
    ...text.matchAll(/(\d+)\s*(?:\+|-|to)?\s*(?:\d+)?\s*(?:years?|yrs?)/g),
  ].some((match) => Number(match[1]) >= 2);
  const hasMandatoryExperience = /\b(minimum|mandatory|requires|required)\s*\d+\s*(?:years?|yrs?)\b/i.test(text);

  if (
    (hasSeniorKeyword || hasTwoPlusYears || hasMandatoryExperience) &&
    !fresherRoleMatches
  ) {
    return "requires senior/experienced profile";
  }

  return "";
};

const getActiveProfile = async () =>
  (await CandidateProfile.findOne({ active: true }).sort({ updatedAt: -1 })) ||
  fallbackProfile;

const saveRawJob = async (company, job) => {
  if (!job.applyLink) {
    console.log(`[Validation Error] Missing applyLink for job: ${job.title}`);
    return null;
  }
  
  if (!job.applyLink.startsWith('https://')) {
    console.log(`[Validation Error] Invalid protocol for job: ${job.title} - URL: ${job.applyLink}`);
    return null;
  }

  const invalidSubstrings = ['undefined', '//job/', 'samecorp', 'example', 'localhost', 'error=true'];
  if (invalidSubstrings.some(sub => job.applyLink.toLowerCase().includes(sub))) {
    console.log(`[Validation Error] Malformed or dummy URL for job: ${job.title} - URL: ${job.applyLink}`);
    return null;
  }
  
  if (job.applyLink.includes('null')) {
      console.log(`[Validation Error] Null placeholder URL for job: ${job.title} - URL: ${job.applyLink}`);
      return null;
  }
  
  try {
    const parsedUrl = new URL(job.applyLink);
    if (!parsedUrl.hostname) {
      console.log(`[Validation Error] Missing hostname for job: ${job.title} - URL: ${job.applyLink}`);
      return null;
    }
    if (parsedUrl.hostname === 'api.smartrecruiters.com') {
      console.log(`[Validation Error] Backend API URL rejected for job: ${job.title} - URL: ${job.applyLink}`);
      return null;
    }
  } catch (e) {
    console.log(`[Validation Error] Unparseable URL for job: ${job.title} - URL: ${job.applyLink}`);
    return null;
  }

  const sourceData = job.sourceChannel ? {
      sourceName: job.sourceName || job.sourceChannel,
      sourceChannel: job.sourceChannel,
      telegramMessageId: job.telegramMessageId,
      firstSeen: new Date(),
      lastSeen: new Date()
  } : null;

  const updateData = {
    $set: {
      title: job.title,
      location: job.location,
      salary: job.salary,
      experience: job.experience,
      description: job.description,
      applyLink: job.applyLink,
      employmentType: job.employmentType,
      postedAt: job.postedAt,
      scrapedAt: new Date(),
    }
  };

  let resolvedJobId = job.jobId;
  if (!resolvedJobId || resolvedJobId === "unknown") {
      resolvedJobId = crypto.createHash("md5").update(job.applyLink).digest("hex");
  }

  const rawJob = await RawJob.findOneAndUpdate(
    { company: company._id, jobId: resolvedJobId },
    updateData,
    { upsert: true, returnDocument: "after" }
  );

  if (sourceData) {
    const updated = await RawJob.findOneAndUpdate(
        { _id: rawJob._id, "sources.sourceChannel": sourceData.sourceChannel },
        { $set: { "sources.$.lastSeen": new Date() } },
        { returnDocument: "after" }
    );
    if (!updated) {
        await RawJob.findByIdAndUpdate(rawJob._id, {
            $push: { sources: sourceData }
        });
        if (job.sourceChannel) {
           await TelegramChannel.findOneAndUpdate(
              { username: job.sourceChannel },
              { $inc: { jobsFound: 1 } }
           );
        }
    }
  }

  return rawJob;
};

const saveMatchedJob = async (rawJob, company, job, analysis) => {
  const score = Number(analysis.score);
  const evaluatedAt = new Date();

  
  rawJob.aiEvaluatedAt = evaluatedAt;

  if (analysis.suitable !== true || score < MATCH_THRESHOLD) {
    
    rawJob.aiMatched = false;
    await rawJob.save();
    return { matched: false, isDuplicate: false };
  }

  const existingJob = await MatchedJob.findOne({ rawJob: rawJob._id });
  if (existingJob) {
      console.log(`[Dedup] Existing job detected for ${job.title}`);
      if (existingJob.status && existingJob.status !== 'new') {
          console.log(`[Dedup] Status preserved: ${existingJob.status}`);
      }
      console.log(`[Dedup] Metadata updated | No duplicate created`);
  }

  await MatchedJob.findOneAndUpdate(
    { rawJob: rawJob._id },
    {
      $set: {
        rawJob: rawJob._id,
        company: company._id,
        role: job.title,
        location: job.location,
        score,
        scoringBreakdown: analysis.scoringBreakdown || {},
        confidence: analysis.confidence,
        suitable: true,
        reason: analysis.reason,
        primaryReasons: analysis.primaryReasons || [],
        missingSkills: analysis.missingSkills || [],
        domainMismatch: analysis.domainMismatch,
        domainExplanation: analysis.domainExplanation || "",
        experienceMismatch: analysis.experienceMismatch,
        roleMatch: analysis.roleMatch,
        experienceMatch: analysis.experienceMatch,
        recommendation: analysis.recommendation,
        applyLink: job.applyLink,
        postedAt: job.postedAt,
        evaluatedBy: analysis.evaluatedBy || "Gemini",
        provider: analysis.provider || "gemini",
        model: analysis.model || "unknown",
        evaluationTimeMs: analysis.evaluationTimeMs || 0,
        fallbackCount: analysis.fallbackCount || 0,
        fallbackReason: analysis.fallbackReason || null,
        evaluationMetrics: analysis.evaluationMetrics || {
            provider: "Gemini",
            durationMs: 0,
            fallbackCount: 0,
            failureReason: null
        },
        lastScrapedAt: new Date(),
        lastMetadataUpdate: new Date(),
        lastAIEvaluation: new Date(),
        isActive: true,
        jobStatus: "Open",
        providerChain: analysis.providerChain || [],
        isDuplicate: !!existingJob
      },
      $push: {
        evaluationHistory: {
          provider: analysis.provider || "gemini",
          model: analysis.model || "unknown",
          score,
          evaluatedAt: evaluatedAt,
          durationMs: analysis.evaluationTimeMs || 0,
          fallbackCount: analysis.fallbackCount || 0,
          fallbackReason: analysis.fallbackReason || null
        }
      }
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );

  rawJob.aiMatched = true;
  await rawJob.save();

  if (job.sourceChannel) {
      await TelegramChannel.findOneAndUpdate(
          { username: job.sourceChannel },
          { $inc: { matchedJobs: 1 } }
      );
  }

  return { matched: true, isDuplicate: !!existingJob };
};

const hasExistingMatch = async (rawJob) =>
  MatchedJob.exists({ rawJob: rawJob._id });

const analyseWithGemini = async (job, profile, aiState) => {
  const skipReason = getSkipReason(job, profile);

  if (skipReason) {
    return { skipped: true, reason: skipReason };
  }

  aiState.calls++;
  
  const analysis = await evaluateJob(job, profile, aiState);

  pipelineState.geminiStatus = aiState.gemini.available ? "Working" : "Unavailable";
  pipelineState.geminiReason = aiState.gemini.reason;
  pipelineState.geminiRequests = aiState.gemini.requests || 0;
  pipelineState.geminiSuccess = aiState.gemini.success || 0;
  pipelineState.geminiFailed = aiState.gemini.failed || 0;
  pipelineState.geminiFallbacks = aiState.geminiFallbacks || 0;
  pipelineState.geminiDisabledAt = aiState.gemini.disabledAt;
  
  pipelineState.groqStatus = aiState.groq.available ? "Working" : "Unavailable";
  pipelineState.groqReason = aiState.groq.reason;
  pipelineState.groqRequests = aiState.groq.requests || 0;
  pipelineState.groqSuccess = aiState.groq.success || 0;
  pipelineState.groqFailed = aiState.groq.failed || 0;
  pipelineState.groqFallbacks = aiState.groqFallbacks || 0;
  pipelineState.groqDisabledAt = aiState.groq.disabledAt;
  
  pipelineState.zaiStatus = aiState.zai.available ? "Working" : "Unavailable";
  pipelineState.zaiReason = aiState.zai.reason;
  pipelineState.zaiRequests = aiState.zai.requests || 0;
  pipelineState.zaiSuccess = aiState.zai.success || 0;
  pipelineState.zaiFailed = aiState.zai.failed || 0;
  pipelineState.zaiFallbacks = aiState.zaiFallbacks || 0;
  pipelineState.zaiDisabledAt = aiState.zai.disabledAt;
  
  pipelineState.localRequests = aiState.local?.requests || 0;
  pipelineState.localSuccess = aiState.local?.success || 0;
  pipelineState.localFailed = aiState.local?.failed || 0;

  if (!analysis || (analysis.errorCode && analysis.provider === "unknown")) {
    return { skipped: true, reason: "Evaluator failed for this job" };
  }

  return { skipped: false, analysis };
};

const saveSearchLog = async (logId, startedAt, stats, errors) => {
  const completedAt = new Date();
  const durationMs = completedAt - startedAt;
  const status = errors.length ? "Partial Success" : "Success";
  
  const message = `[${status}] Scanned ${stats.companiesScanned} companies, found ${stats.jobsFound} jobs, matched ${stats.jobsMatched} jobs. Duration: ${(durationMs/1000).toFixed(1)}s`;

  
  await SearchLog.findByIdAndUpdate(logId, {
    completedAt,
    durationMs,
    companiesScanned: stats.companiesScanned,
    jobsFound: stats.jobsFound,
    jobsMatched: stats.jobsMatched,
    jobsArchived: stats.jobsArchived,
    jobsRefreshed: stats.jobsRefreshed,
    duplicatePreventionCount: stats.duplicatePreventionCount,
    averageEvaluationTimeMs: stats.jobsMatched > 0 ? Math.round(stats.totalEvaluationTimeMs / stats.jobsMatched) : 0,
    averageMetadataRefreshTimeMs: stats.jobsRefreshed > 0 ? Math.round(stats.totalMetadataRefreshTimeMs / stats.jobsRefreshed) : 0,
    totalCompanies: stats.companiesScanned,
    successfulCompanies: stats.successfulCompanies,
    failedCompanies: stats.failedCompanies,
    totalJobs: stats.jobsFound,
    newJobs: stats.newJobs,
    aiEvaluations: stats.aiEvaluations,
    geminiCount: stats.geminiCount,
    geminiSuccess: stats.geminiSuccess,
    geminiFailed: stats.geminiFailed,
    geminiFallbacks: stats.geminiFallbacks,
    groqCount: stats.groqCount,
    groqSuccess: stats.groqSuccess,
    groqFailed: stats.groqFailed,
    groqFallbacks: stats.groqFallbacks,
    zaiCount: stats.zaiCount,
    zaiSuccess: stats.zaiSuccess,
    zaiFailed: stats.zaiFailed,
    zaiFallbacks: stats.zaiFallbacks,
    localCount: stats.localCount,
    localSuccess: stats.localSuccess,
    averageCompanyTime: stats.companiesScanned > 0 ? Math.round(durationMs / stats.companiesScanned) : 0,
    status,
    message,
    errorDetails: errors,
    aiProviderUsed: stats.aiProviderUsed || "None",
  });
};

const runSearch = async (triggerSource = "Unknown") => {
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
        expiresAt: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000)
      }
    },
    { returnDocument: "after" }
  );

  const pipelineId = `${startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${runnerName.replace(/\s+/g, '').toUpperCase()}`;

  if (!lock) {
    const currentLock = await PipelineLock.findOne({ lockId: "global_pipeline_lock" });
    console.log(`[Pipeline] Another execution is already running. Skipping.`);
    await SearchLog.create({
      pipelineId,
      triggerSource: runnerName,
      status: "Skipped",
      skipReason: "Distributed lock already active",
      currentRunner: currentLock ? currentLock.runner : "Unknown",
      expectedUnlock: currentLock ? currentLock.expiresAt : null,
      startedAt: startedAt,
      completedAt: new Date(),
      durationMs: new Date() - startedAt
    });
    return { skipped: true, reason: "Already running" };
  }

  const pipelineLog = await SearchLog.create({
    pipelineId,
    triggerSource: runnerName,
    status: "Running",
    startedAt: startedAt
  });

  console.log(`[Pipeline] ID: ${pipelineId} | Trigger source: ${runnerName}. Start time: ${startedAt.toISOString()}`);

  const stats = {
    companiesScanned: 0,
    successfulCompanies: 0,
    failedCompanies: 0,
    jobsFound: 0,
    jobsMatched: 0,
    newJobs: 0,
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

  pipelineState.status = "Running";
  pipelineState.pipelineId = pipelineId;
  pipelineState.jobsScraped = 0;
  pipelineState.jobsEvaluated = 0;
  pipelineState.jobsMatched = 0;
  pipelineState.lastRunTime = startedAt;
  pipelineState.message = "Pipeline is currently running...";
  pipelineState.currentStage = "Initializing";
  pipelineState.currentCompany = null;
  pipelineState.progress = "0 / 0 companies";
  pipelineState.elapsedTime = 0;
  pipelineState.estimatedRemainingTime = 0;
  pipelineState.currentAiProvider = null;

  console.log("=================================");
  console.log("Job Search Started...");
  console.log("=================================");

  const errors = [];

  try {
    const companies = await Company.find({ active: true });
    const profile = await getActiveProfile();

    stats.companiesScanned = companies.length;

    // Use p-limit for concurrent scraping (max 5 companies at a time)
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(5);

    let completedCompanies = 0;

    await Promise.allSettled(companies.map((company) => limit(async () => {
      pipelineState.currentCompany = company.name;
      pipelineState.currentStage = "Fetching Jobs";
      pipelineState.progress = `${completedCompanies} / ${stats.companiesScanned} companies`;
      pipelineState.elapsedTime = Date.now() - startedAt;
      if (completedCompanies > 0) {
          pipelineState.estimatedRemainingTime = (pipelineState.elapsedTime / completedCompanies) * (stats.companiesScanned - completedCompanies);
      }

      console.log(`Searching ${company.name}...`);
      let companyJobsFound = 0;
      let companyJobsMatched = 0;
      let companyStatus = "success";
      let companyErrorMsg = null;
      let companyErrors = 0;

      try {
        const scrapedJobs = await scrapeCompanyJobs(company);

        console.log(`${company.name} returned ${scrapedJobs.length} jobs`);

        if (company.name === "Visa") {
          console.log(
            "Visa Sample Jobs:",
            scrapedJobs.slice(0, 5).map((job) => ({
              title: job.title,
              location: job.location,
              jobId: job.jobId,
            })),
          );
        }

        companyJobsFound = scrapedJobs.length;
        stats.jobsFound += scrapedJobs.length;
        pipelineState.jobsScraped = stats.jobsFound;

        const jobsToProcess = scrapedJobs.slice(0, MAX_JOBS_PER_COMPANY);

        for (const job of jobsToProcess) {
          const rawJob = await saveRawJob(company, job);
          console.log(`Saved Job: ${job.title} (${company.name})`);

          try {
            if (rawJob.aiMatched || await hasExistingMatch(rawJob)) {
              console.log(`[Dedup] Existing job detected for ${job.title} (${company.name})`);
              console.log(`[Metadata] Refreshed existing job: ${job.title}`);
              
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
              continue;
            }

            pipelineState.currentStage = "AI Evaluation";
            const evalStart = Date.now();
            const result = await analyseWithGemini(job, profile, aiState);
            if (result.analysis && result.analysis.evaluationTimeMs) {
                stats.totalEvaluationTimeMs += result.analysis.evaluationTimeMs;
            }
            stats.aiEvaluations++;
            if (result.analysis && result.analysis.provider) {
                pipelineState.currentAiProvider = result.analysis.provider.toLowerCase();
            } else if (!result.skipped) {
                pipelineState.currentAiProvider = 'gemini';
            }
            pipelineState.jobsEvaluated++;

            if (result.skipped) {
              console.log(
                `Skipped Gemini analysis for ${job.title}: ${result.reason}`,
              );
              continue;
            }

            pipelineState.currentStage = "Saving Results";
            
            // ML Dataset Collection (Asynchronous, Non-Blocking)
            if (result.analysis) {
               saveTrainingSample(job, company, result.analysis, pipelineId, triggerSource).catch(err => {
                  console.log(`[TrainingDataset] Async save error: ${err.message}`);
               });
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
              console.log(`[Production Log] Pipeline ID: ${pipelineId} | Runner: ${runnerName} | Trigger: ${runnerName} | Company: ${company.name} | Job: ${job.title} | Provider: ${providerStr} | Provider Chain: ${providerChainStr} | Duration: ${result.analysis.evaluationTimeMs || 0}ms | Success: true | Failure: false | Reason: Matched (${result.analysis.score}) | Email Status: ${isDuplicate ? 'Skipped' : 'Sent'} | Training Dataset Status: ${result.analysis ? 'Saved' : 'N/A'}`);
              
              if (!isDuplicate) {
                try {
                  await sendMatchedJobEmail({
                    company,
                    job,
                    analysis: result.analysis,
                    pipelineId,
                    isDuplicate: false
                  });
                } catch (emailError) {
                  // Error is already logged in sendMatchedJobEmail
                }
              } else {
                 console.log(`[Job Evaluated] Email Skipped: Duplicate Job | Job: ${job.title} | Company: ${company.name}`);
              }
            } else {
               const providerStr = result.analysis?.provider ? result.analysis.provider.charAt(0).toUpperCase() + result.analysis.provider.slice(1) : "Unknown";
               const providerChainStr = result.analysis?.providerChain ? result.analysis.providerChain.join(' -> ') : providerStr;
               console.log(`[Production Log] Pipeline ID: ${pipelineId} | Runner: ${runnerName} | Trigger: ${runnerName} | Company: ${company.name} | Job: ${job.title} | Provider: ${providerStr} | Provider Chain: ${providerChainStr} | Duration: ${result.analysis?.evaluationTimeMs || 0}ms | Success: true | Failure: false | Reason: Not Matched | Email Status: Skipped | Training Dataset Status: ${result.analysis ? 'Saved' : 'N/A'}`);
            }
          } catch (error) {
            companyErrors++;
            errors.push({
              company: company.name,
              jobTitle: job.title,
              message: error.message,
            });
            console.error(`[Production Log] Pipeline ID: ${pipelineId} | Runner: ${runnerName} | Trigger: ${runnerName} | Company: ${company.name} | Job: ${job.title} | Provider: N/A | Provider Chain: N/A | Duration: 0ms | Success: false | Failure: true | Reason: ${error.message} | Email Status: Skipped | Training Dataset Status: Failed`);
          }
        }

        if (companyErrors > 0) {
          companyStatus = "partial";
          companyErrorMsg = `${companyErrors} jobs failed analysis`;
          stats.failedCompanies++;
        } else {
          stats.successfulCompanies++;
        }
        
        // --------------------------------------------------
        // Closed Job Detection
        // --------------------------------------------------
        if (scrapedJobs.length > 0) {
            const crypto = require("crypto");
            const activeJobIds = scrapedJobs.map(j => {
                let jId = j.jobId;
                if (!jId || jId === "unknown") jId = crypto.createHash("md5").update(j.applyLink || "").digest("hex");
                return jId;
            });
            
            // Find raw jobs that belong to this company but are not in activeJobIds
            const missingRawJobs = await RawJob.find({ company: company._id, jobId: { $nin: activeJobIds } }).select("_id");
            const missingRawJobIds = missingRawJobs.map(r => r._id);
            
            if (missingRawJobIds.length > 0) {
                const archiveResult = await MatchedJob.updateMany(
                    { rawJob: { $in: missingRawJobIds }, isActive: { $ne: false } },
                    { $set: { isActive: false, jobStatus: "Closed", closedAt: new Date() } }
                );
                if (archiveResult.modifiedCount > 0) {
                    console.log(`[Archive] Job marked Closed: ${archiveResult.modifiedCount} jobs for ${company.name}`);
                    stats.jobsArchived += archiveResult.modifiedCount;
                }
            }
        }
        
      } catch (error) {
        companyStatus = "failed";
        companyErrorMsg = error.message;
        stats.failedCompanies++;
        errors.push({
          company: company.name,
          message: error.message,
        });
        console.error(`Scrape Error for ${company.name}:`, error.message);
      }

      completedCompanies++;
      pipelineState.progress = `${completedCompanies} / ${stats.companiesScanned} companies`;
      pipelineState.elapsedTime = Date.now() - startedAt;

      company.jobsFound = companyJobsFound;
      company.matchedJobs = companyJobsMatched;
      company.lastScan = new Date();
      company.lastRunStatus = companyStatus;
      if (companyErrorMsg) company.lastError = companyErrorMsg;
      await company.save();
    })));
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

    await saveSearchLog(pipelineLog._id, startedAt, stats, errors);

    console.log("=================================");
    console.log("Job Search Completed");
    console.log(`Companies Scanned: ${stats.companiesScanned}`);
    console.log(`Jobs Found: ${stats.jobsFound}`);
    console.log(`Jobs Matched: ${stats.jobsMatched}`);
    console.log("=================================");
    
    if (errors.length > 0) {
      pipelineState.status = "Completed with Warnings";
      pipelineState.message = `Completed with ${errors.length} warnings.`;
    } else {
      pipelineState.status = "Completed";
      pipelineState.message = "Last run completed successfully.";
    }
    pipelineState.lastRunDuration = new Date() - startedAt;
  } catch (error) {
    console.error("Cron Error:", error.message);

    pipelineState.status = "Failed";
    pipelineState.lastRunDuration = new Date() - startedAt;
    pipelineState.message = `Failed: ${error.message}`;

    await SearchLog.findByIdAndUpdate(pipelineLog._id, {
      completedAt: new Date(),
      durationMs: new Date() - startedAt,
      status: "Failed",
      message: `Failed: ${error.message}`,
      errorType: error.name || "Error",
      stackTrace: error.stack,
      companyBeingProcessed: pipelineState.currentCompany,
      currentStage: pipelineState.currentStage,
      companiesScanned: stats.companiesScanned,
      successfulCompanies: stats.successfulCompanies,
      failedCompanies: stats.failedCompanies,
      totalJobs: stats.jobsFound,
      jobsMatched: stats.jobsMatched,
      errorDetails: [{ message: error.message }],
    });
  } finally {
    const endTime = new Date();
    const duration = endTime - startedAt;
    console.log(`[Pipeline] End time: ${endTime.toISOString()}. Duration: ${duration}ms`);
    
    await PipelineLock.updateOne(
      { lockId: "global_pipeline_lock" },
      { $set: { status: "Idle", runner: "none" } }
    );
  }
};


// Internal node-cron scheduling restored for Azure
const schedule = "0 2 * * *";
const cronTask = cron.schedule(schedule, () => runSearch("Azure Cron"));

pipelineState.nextRunTime = "Scheduled for 02:00 AM daily";


module.exports = runSearch;
module.exports.runSearch = runSearch;
module.exports.saveRawJob = saveRawJob;
module.exports.saveMatchedJob = saveMatchedJob;
module.exports.hasExistingMatch = hasExistingMatch;
module.exports.analyseWithGemini = analyseWithGemini;
module.exports.getActiveProfile = getActiveProfile;
module.exports.saveSearchLog = saveSearchLog;
