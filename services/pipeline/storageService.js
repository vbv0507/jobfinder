const crypto = require("crypto");
const RawJob = require("../../models/RawJob");
const MatchedJob = require("../../models/MatchedJob");
const SearchLog = require("../../models/SearchLog");
const TelegramChannel = require("../../models/TelegramChannel");
const { normalizeDate } = require("../../utils/dateNormalizer");

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);

const saveRawJob = async (company, job, stats = null) => {
  const saveStartTime = performance.now();
  let status = 'saved';

  const logValidationFailure = (rule, reason) => {
      if (stats) stats.validationDrops++;
      let hostname = "Unknown";
      let protocol = "Unknown";
      let path = "Unknown";
      try {
          if (job.applyLink) {
              const p = new URL(job.applyLink.toString().trim());
              hostname = p.hostname;
              protocol = p.protocol;
              path = p.pathname;
          }
      } catch (e) {}

      // Ensure it prints even if console.log was mutated by the caller
      const logger = console.log.name !== "" ? console.log : require('console').log; 
      
      logger("\n[saveRawJob]\nValidation Failed");
      logger("Validation Rule:\n" + rule);
      logger("URL:\n" + (job.applyLink || "Undefined"));
      logger("Hostname:\n" + hostname);
      logger("Protocol:\n" + protocol);
      logger("Path:\n" + path);
      logger("Reason:\n" + reason);
      logger("Returning null\n");
  };

  if (!job.applyLink) {
    logValidationFailure("Missing applyLink", "No applyLink provided for job");
    return null;
  }
  
  if (!job.applyLink.startsWith('https://')) {
    logValidationFailure("Invalid protocol", "URL must start with https://");
    return null;
  }

  const invalidSubstrings = ['undefined', '//job/', 'samecorp', 'example', 'localhost', 'error=true'];
  if (invalidSubstrings.some(sub => job.applyLink.toLowerCase().includes(sub))) {
    logValidationFailure("Malformed URL", "Contains blocked substring");
    return null;
  }
  
  if (job.applyLink.includes('null')) {
      logValidationFailure("Null placeholder", "URL string literally contains 'null'");
      return null;
  }
  
  try {
    const parsedUrl = new URL(job.applyLink);
    if (!parsedUrl.hostname) {
      logValidationFailure("Missing hostname", "Hostname could not be parsed");
      return null;
    }
    if (parsedUrl.hostname === 'api.smartrecruiters.com') {
      logValidationFailure("Backend API rejected", "api.smartrecruiters.com is blocked");
      return null;
    }
  } catch (e) {
    logValidationFailure("Unparseable URL", "new URL() constructor threw an exception");
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
      postedAt: normalizeDate(job.postedAt),
      scrapedAt: new Date(),
    }
  };

  let resolvedJobId = job.jobId;
  if (!resolvedJobId || resolvedJobId === "unknown") {
      resolvedJobId = crypto.createHash("md5").update(job.applyLink).digest("hex");
  }

  let rawJob;
  try {
    rawJob = await RawJob.findOneAndUpdate(
      { company: company._id, jobId: resolvedJobId },
      updateData,
      { upsert: true, returnDocument: "after" }
    );
  } catch (err) {
    if (err.code === 11000) {
      if (stats) stats.duplicates++;
      return null;
    }
    console.error(`[saveRawJob] Mongo Error: ${err.message}`);
    return null;
  }

  if (stats) {
    stats.jobsSaved++;
    stats.totalSaveTime = (stats.totalSaveTime || 0) + (performance.now() - saveStartTime);
  }

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
  rawJob.aiEvaluated = true;

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
    skippedRuns: stats.cachedCompanies,
    parserOutdated: stats.parserOutdated,
    atsChanged: stats.atsChanged,
    httpFailed: stats.httpFailed,
    blocked: stats.blocked,
    retriedSuccessfully: stats.retriedSuccessfully,
    companiesWithJobs: stats.companiesWithJobs,
    companiesWithoutJobs: stats.companiesWithoutJobs,
    totalJobs: stats.jobsFound,
    newJobs: stats.newJobs,
    jobsScraped: stats.jobsScraped,
    jobsSaved: stats.jobsSaved,
    jobsEvaluated: stats.jobsEvaluated,
    validationDrops: stats.validationDrops,
    validationDropsByReason: stats.validationDropsByReason,
    duplicates: stats.duplicates,
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

  return logId;
};

module.exports = { saveRawJob, saveMatchedJob, hasExistingMatch, saveSearchLog };
