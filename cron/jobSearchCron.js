const cron = require("node-cron");

const Company = require("../models/Company");
const RawJob = require("../models/RawJob");
const MatchedJob = require("../models/MatchedJob");
const SearchLog = require("../models/SearchLog");
const CandidateProfile = require("../models/CandidateProfile");

const fallbackProfile = require("../profile");

const { scrapeCompanyJobs } = require("../services/scraperService");
const { evaluateJob } = require("../services/geminiService");

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 70);
const MAX_JOBS_PER_COMPANY = Number(process.env.MAX_JOBS_PER_COMPANY || 10);
const MAX_AI_CALLS = Number(process.env.MAX_AI_EVALUATIONS_PER_RUN || 15);
const STRICT_LOCATION_MATCH = process.env.STRICT_LOCATION_MATCH !== "false";

const getJobText = (job) =>
  [job.title, job.location, job.experience, job.description, job.employmentType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

// This filter protects Gemini quota.
// We call AI only when the job already looks close to the candidate profile.
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
  const fresherRoleMatches =
    /intern|internship|fresher|graduate|new grad|entry level|campus|trainee|0\s*-\s*1|0\s*to\s*1/i.test(
      text,
    );

  if (!roleMatches && !technicalRoleMatches && !fresherRoleMatches) {
    return "role not aligned with profile";
  }

  const hasSeniorKeyword =
    /\b(senior|sr\.|lead|principal|manager|director|architect|staff)\b/i.test(
      text,
    );
  const hasTwoPlusYears = [
    ...text.matchAll(/(\d+)\s*\+?\s*(?:-|to)?\s*(\d+)?\s*(?:years?|yrs?)/g),
  ].some((match) => Number(match[1]) >= 2);

  if ((hasSeniorKeyword || hasTwoPlusYears) && !fresherRoleMatches) {
    return "requires senior/experienced profile";
  }

  return "";
};

const getActiveProfile = async () =>
  (await CandidateProfile.findOne({ active: true }).sort({ updatedAt: -1 })) ||
  fallbackProfile;

const saveRawJob = async (company, job) => {
  // Check if job already exists with same scrapedAt date (today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existingJob = await RawJob.findOne({
    company: company._id,
    jobId: job.jobId,
    scrapedAt: { $gte: today }
  });

  // If job already fetched today, skip it
  if (existingJob) {
    return existingJob;
  }

  // Save new or update old job
  return await RawJob.findOneAndUpdate(
    {
      company: company._id,
      jobId: job.jobId,
    },
    {
      $set: {
        company: company._id,
        title: job.title,
        location: job.location,
        jobId: job.jobId,
        experience: job.experience,
        description: job.description,
        applyLink: job.applyLink,
        employmentType: job.employmentType,
        postedAt: job.postedAt,
        scrapedAt: new Date(),
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    },
  );
};

const saveMatchedJob = async (rawJob, company, job, analysis) => {
  const score = Number(analysis.score);

  if (analysis.suitable !== true || score < MATCH_THRESHOLD) {
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
        suitable: true,
        reason: analysis.reason,
        missingSkills: analysis.missingSkills || [],
        roleMatch: analysis.roleMatch,
        experienceMatch: analysis.experienceMatch,
        recommendation: analysis.recommendation,
        applyLink: job.applyLink,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );

  return true;
};

const analyseWithGemini = async (job, profile, aiState) => {
  const skipReason = getSkipReason(job, profile);

  if (skipReason) {
    return { skipped: true, reason: skipReason };
  }

  if (aiState.calls >= MAX_AI_CALLS) {
    return { skipped: true, reason: "AI evaluation limit reached" };
  }

  if (aiState.quotaExceeded) {
    return { skipped: true, reason: "Gemini quota already exceeded" };
  }

  aiState.calls++;
  const analysis = await evaluateJob(job, profile);

  if (analysis.errorCode === "QUOTA_EXCEEDED") {
    aiState.quotaExceeded = true;
    return { skipped: true, reason: "Gemini quota exceeded" };
  }

  return { skipped: false, analysis };
};

const saveSearchLog = async (startedAt, stats, errors) => {
  const completedAt = new Date();

  await SearchLog.create({
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    companiesScanned: stats.companiesScanned,
    jobsFound: stats.jobsFound,
    jobsMatched: stats.jobsMatched,
    status: errors.length ? "Partial Success" : "Success",
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
    calls: 0,
    quotaExceeded: false,
  };

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

      const jobsToProcess = scrapedJobs.slice(0, MAX_JOBS_PER_COMPANY);

      for (const job of jobsToProcess) {
        const rawJob = await saveRawJob(company, job);
        console.log(`Saved Job: ${job.title} (${company.name})`);

        try {
          const result = await analyseWithGemini(job, profile, aiState);

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
            console.log(
              `Matched Job: ${job.title} | Score: ${result.analysis.score}`,
            );
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
  } catch (error) {
    console.error("Cron Error:", error.message);

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

// Runs automatically every day at 2:00 AM.
cron.schedule("0 2 * * *", runSearch);

// Exported so index.js can run it manually when RUN_SEARCH_ON_START=true.
module.exports = runSearch;
