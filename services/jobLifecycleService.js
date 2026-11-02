const MatchedJob = require("../models/MatchedJob");
const RejectedJob = require("../models/RejectedJob");
require("../models/RawJob");
const CacheManager = require("./cacheManager");
const { getSkipReason } = require("./pipeline/aiEvaluationService");

const CLOSED_LISTING_PATTERN = /\b(?:position|role|job|opening|application)s?\s+(?:is\s+)?(?:closed|filled|removed|expired)|\b(?:no longer accepting applications|applications? (?:are )?closed|position has been filled)\b/i;

const getListingText = (matchedJob) => [
  matchedJob.role,
  matchedJob.reason,
  matchedJob.rawJob?.title,
  matchedJob.rawJob?.description,
].filter(Boolean).join(" ");

const isExplicitlyClosed = (matchedJob) => CLOSED_LISTING_PATTERN.test(getListingText(matchedJob));

const closeMatchedJob = async (matchedJob, closedAt = new Date()) =>
  MatchedJob.updateOne(
    { _id: matchedJob._id },
    { $set: { isActive: false, jobStatus: "Closed", closedAt } },
  );

const moveOutOfMatchedJobs = async (matchedJob, reason) => {
  const now = new Date();
  const rawJob = matchedJob.rawJob;

  await RejectedJob.findOneAndUpdate(
    { rawJob: rawJob._id },
    {
      $set: {
        rawJob: rawJob._id,
        company: matchedJob.company,
        role: matchedJob.role || rawJob.title,
        location: matchedJob.location || rawJob.location,
        score: 0,
        suitable: false,
        reason: `Profile alignment update: ${reason}`,
        primaryReasons: [reason],
        evaluatedBy: "ProfilePolicy",
        provider: "pre-filter",
        model: "strict-role-v1",
        applyLink: matchedJob.applyLink || rawJob.applyLink,
        postedAt: matchedJob.postedAt || rawJob.postedAt,
        lastScrapedAt: now,
        lastAIEvaluation: now,
        jobStatus: "Open",
        isActive: true,
      },
    },
    { upsert: true },
  );

  rawJob.aiMatched = false;
  rawJob.aiEvaluated = true;
  rawJob.aiEvaluatedAt = now;
  await rawJob.save();

  await MatchedJob.deleteOne({ _id: matchedJob._id });
};

const reconcileMatchedJobs = async (profile) => {
  const matchedJobs = await MatchedJob.find({
    isActive: { $ne: false },
    jobStatus: { $ne: "Closed" },
  }).populate("rawJob");
  const stats = { scanned: matchedJobs.length, closed: 0, movedToRejected: 0, preservedApplied: 0 };

  for (const matchedJob of matchedJobs) {
    if (!matchedJob.rawJob) continue;

    if (isExplicitlyClosed(matchedJob)) {
      await closeMatchedJob(matchedJob);
      stats.closed++;
      continue;
    }

    const reason = getSkipReason(matchedJob.rawJob, profile);
    if (!reason) continue;

    if (matchedJob.status === "applied") {
      stats.preservedApplied++;
      continue;
    }

    await moveOutOfMatchedJobs(matchedJob, reason);
    stats.movedToRejected++;
  }

  if (stats.closed || stats.movedToRejected) CacheManager.invalidate();
  return stats;
};

module.exports = { isExplicitlyClosed, closeMatchedJob, reconcileMatchedJobs };
