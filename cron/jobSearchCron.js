const cron = require("node-cron");

const Company = require("../models/Company");
const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");
const CandidateProfile = require("../models/CandidateProfile");
const TelegramChannel = require("../models/TelegramChannel");

const fallbackProfile = require("../profile");

const { scrapeCompanyJobs } = require("../services/scraperService");
const { evaluateJob } = require("../services/geminiService");
const { sendMatchedJobEmail } = require("../services/emailService");
const { classifyDomain } = require("../utils/domains");
const pipelineState = require("../services/pipelineState");

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
  
  
  const duplicateChecks = [];

  if (job.jobId) {
    duplicateChecks.push({ jobId: job.jobId });
  }
  if (job.applyLink) {
    duplicateChecks.push({ applyLink: job.applyLink });
  }

  const existingJob = await RawJob.findOne({
    company: company._id,
    $or: duplicateChecks,
  });

  const sourceData = job.sourceChannel ? {
      sourceName: job.sourceName || job.sourceChannel,
      sourceChannel: job.sourceChannel,
      telegramMessageId: job.telegramMessageId,
      firstSeen: new Date(),
      lastSeen: new Date()
  } : null;

  if (existingJob) {
    
    existingJob.title = job.title;
    existingJob.location = job.location;
    existingJob.salary = job.salary;
    existingJob.experience = job.experience;
    existingJob.description = job.description;
    existingJob.applyLink = job.applyLink;
    existingJob.employmentType = job.employmentType;
    existingJob.postedAt = job.postedAt;
    existingJob.scrapedAt = new Date();

    if (sourceData) {
        
        const existingSourceIndex = existingJob.sources.findIndex(s => s.sourceChannel === sourceData.sourceChannel);
        if (existingSourceIndex >= 0) {
            existingJob.sources[existingSourceIndex].lastSeen = new Date();
        } else {
            existingJob.sources.push(sourceData);
        }
    }

    return existingJob.save();
  }

  if (job.sourceChannel) {
      await TelegramChannel.findOneAndUpdate(
          { username: job.sourceChannel },
          { $inc: { jobsFound: 1 } }
      );
  }

  return RawJob.create({
      company: company._id,
      title: job.title,
      location: job.location,
      salary: job.salary,
      jobId: job.jobId,
      experience: job.experience,
      description: job.description,
      applyLink: job.applyLink,
      employmentType: job.employmentType,
      postedAt: job.postedAt,
      scrapedAt: new Date(),
      sources: sourceData ? [sourceData] : []
  });
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
        evaluationMetrics: analysis.evaluationMetrics || {
            provider: "Gemini",
            durationMs: 0,
            fallbackCount: 0,
            failureReason: null
        }
      },
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
    status,
    message,
    errorDetails: errors,
  });
};

const runSearch = async () => {
  const startedAt = new Date();
  const errors = [];
  const stats = {
    companiesScanned: 0,
    jobsFound: 0,
    jobsMatched: 0,
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

    for (const company of companies) {
      console.log(`Searching ${company.name}...`);

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

      stats.jobsFound += scrapedJobs.length;
      pipelineState.jobsScraped = stats.jobsFound;

      const jobsToProcess = scrapedJobs.slice(0, MAX_JOBS_PER_COMPANY);

      for (const job of jobsToProcess) {
        const rawJob = await saveRawJob(company, job);
        console.log(`Saved Job: ${job.title} (${company.name})`);

        try {
          if (rawJob.aiMatched || await hasExistingMatch(rawJob)) {
            
            console.log(
              `Skipped AI analysis for ${job.title}: already matched earlier`,
            );
            continue;
          }

          const result = await analyseWithGemini(job, profile, aiState);
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
            pipelineState.jobsMatched++;
            console.log(
              `Matched Job: ${job.title} | Score: ${result.analysis.score}`,
            );

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
          errors.push({
            company: company.name,
            jobTitle: job.title,
            message: error.message,
          });
          console.error(`Gemini Error for ${job.title}:`, error.message);
        }
      }
    }

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
  }
};


const schedule = "0 2 * * *";
const cronTask = cron.schedule(schedule, runSearch);


pipelineState.nextRunTime = "Scheduled for 02:00 AM daily";


module.exports = runSearch;
module.exports.runSearch = runSearch;
module.exports.saveRawJob = saveRawJob;
module.exports.saveMatchedJob = saveMatchedJob;
module.exports.hasExistingMatch = hasExistingMatch;
module.exports.analyseWithGemini = analyseWithGemini;
module.exports.getActiveProfile = getActiveProfile;
module.exports.saveSearchLog = saveSearchLog;
