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
const { classifyDomain } = require("../utils/domains");
const pipelineState = require("../services/pipelineState");
const crypto = require("crypto");

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);
const MAX_JOBS_PER_COMPANY = Number(process.env.MAX_JOBS_PER_COMPANY || 10);
const MAX_AI_CALLS = Number(process.env.MAX_AI_EVALUATIONS_PER_RUN || 15);
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
    { new: true, upsert: true, returnDocument: "after" }
  );

  if (sourceData) {
    const updated = await RawJob.findOneAndUpdate(
        { _id: rawJob._id, "sources.sourceChannel": sourceData.sourceChannel },
        { $set: { "sources.$.lastSeen": new Date() } },
        { new: true }
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

  
  rawJob.aiEvaluated = true;
  rawJob.aiEvaluatedAt = evaluatedAt;

  if (analysis.suitable !== true || score < MATCH_THRESHOLD) {
    
    rawJob.aiMatched = false;
    await rawJob.save();
    return false;
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
        jobStatus: "Open"
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

  return true;
};

const hasExistingMatch = async (rawJob) =>
  MatchedJob.exists({ rawJob: rawJob._id });

const analyseWithGemini = async (job, profile, aiState) => {
  const skipReason = getSkipReason(job, profile);

  if (skipReason) {
    
    return { skipped: true, reason: skipReason };
  }

  if (aiState.calls >= MAX_AI_CALLS) {
    return { skipped: true, reason: "AI evaluation limit reached" };
  }

  aiState.calls++;
  
  const analysis = await evaluateJob(job, profile);

  if (analysis.errorCode === "QUOTA_EXCEEDED" || analysis.errorCode === "GEMINI_FAILED") {
    return { skipped: true, reason: "Evaluator failed for this job" };
  }

  return { skipped: false, analysis };
};

const saveSearchLog = async (startedAt, stats, errors) => {
  const completedAt = new Date();
  const durationMs = completedAt - startedAt;
  const status = errors.length ? "Partial Success" : "Success";
  
  const message = `[${status}] Scanned ${stats.companiesScanned} companies, found ${stats.jobsFound} jobs, matched ${stats.jobsMatched} jobs. Duration: ${(durationMs/1000).toFixed(1)}s`;

  
  await SearchLog.create({
    startedAt,
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
    status,
    message,
    errorDetails: errors,
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
    { new: true }
  );

  if (!lock) {
    console.log(`[Pipeline] Another execution is already running. Skipping.`);
    return { skipped: true, reason: "Already running" };
  }

  console.log(`[Pipeline] Trigger source: ${runnerName}. Start time: ${startedAt.toISOString()}`);

  const errors = [];
  const stats = {
    companiesScanned: 0,
    jobsFound: 0,
    jobsMatched: 0,
    jobsArchived: 0,
    jobsRefreshed: 0,
    duplicatePreventionCount: 0,
    totalEvaluationTimeMs: 0,
    totalMetadataRefreshTimeMs: 0,
  };
  const aiState = {
    calls: 0
  };

  pipelineState.status = "Running";
  pipelineState.jobsScraped = 0;
  pipelineState.jobsEvaluated = 0;
  pipelineState.jobsMatched = 0;
  pipelineState.lastRunTime = startedAt;
  pipelineState.message = "Pipeline is currently running...";

  console.log("=================================");
  console.log("Job Search Started...");
  console.log("=================================");

  try {
    const companies = await Company.find({ active: true });
    const profile = await getActiveProfile();

    stats.companiesScanned = companies.length;

    // Use p-limit for concurrent scraping (max 5 companies at a time)
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(5);

    await Promise.allSettled(companies.map((company) => limit(async () => {
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

            const evalStart = Date.now();
            const result = await analyseWithGemini(job, profile, aiState);
            if (result.analysis && result.analysis.evaluationTimeMs) {
                stats.totalEvaluationTimeMs += result.analysis.evaluationTimeMs;
            }
            pipelineState.jobsEvaluated++;

            if (result.skipped) {
              console.log(
                `Skipped Gemini analysis for ${job.title}: ${result.reason}`,
              );
              continue;
            }

            const matched = await saveMatchedJob(
              rawJob,
              company,
              job,
              result.analysis,
            );

            if (matched) {
              stats.jobsMatched++;
              companyJobsMatched++;
              pipelineState.jobsMatched++;
              
              const providerStr = result.analysis.provider ? result.analysis.provider.charAt(0).toUpperCase() + result.analysis.provider.slice(1) : "Gemini";
              console.log(`Matched Job: ${job.title} | Score: ${result.analysis.score}`);
              
              if (result.analysis.fallbackReason) {
                  console.log(`[AI] Provider: ${providerStr} | Reason: ${result.analysis.fallbackReason} | Time: ${result.analysis.evaluationTimeMs}ms`);
              } else {
                  console.log(`[AI] Provider: ${providerStr} | Model: ${result.analysis.model} | Time: ${result.analysis.evaluationTimeMs}ms | Fallbacks: ${result.analysis.fallbackCount}`);
              }

              try {
                
                await sendMatchedJobEmail({
                  company,
                  job,
                  analysis: result.analysis,
                });
                console.log(`Email sent for matched job: ${job.title}`);
              } catch (emailError) {
                console.log(`Email failed for ${job.title}: ${emailError.message}`);
              }
            }
          } catch (error) {
            companyErrors++;
            errors.push({
              company: company.name,
              jobTitle: job.title,
              message: error.message,
            });
            console.error(`Gemini Error for ${job.title}:`, error.message);
          }
        }

        if (companyErrors > 0) {
          companyStatus = "partial";
          companyErrorMsg = `${companyErrors} jobs failed analysis`;
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
        errors.push({
          company: company.name,
          message: error.message,
        });
        console.error(`Scrape Error for ${company.name}:`, error.message);
      }

      company.jobsFound = companyJobsFound;
      company.matchedJobs = companyJobsMatched;
      company.lastScan = new Date();
      company.lastRunStatus = companyStatus;
      if (companyErrorMsg) company.lastError = companyErrorMsg;
      await company.save();
    })));

    await saveSearchLog(startedAt, stats, errors);

    console.log("=================================");
    console.log("Job Search Completed");
    console.log(`Companies Scanned: ${stats.companiesScanned}`);
    console.log(`Jobs Found: ${stats.jobsFound}`);
    console.log(`Jobs Matched: ${stats.jobsMatched}`);
    console.log("=================================");
    
    pipelineState.status = "Idle";
    pipelineState.lastRunDuration = new Date() - startedAt;
    pipelineState.message = "Last run completed successfully.";
  } catch (error) {
    console.error("Cron Error:", error.message);

    pipelineState.status = "Failed";
    pipelineState.lastRunDuration = new Date() - startedAt;
    pipelineState.message = `Failed: ${error.message}`;

    await saveSearchLog(
      startedAt,
      {
        companiesScanned: stats.companiesScanned,
        jobsFound: stats.jobsFound,
        jobsMatched: stats.jobsMatched,
      },
      [{ message: error.message }],
    );
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
