const { evaluateJob } = require("../geminiService");
const CandidateProfile = require("../../models/CandidateProfile");
const fallbackProfile = require("../../profile");
const { classifyDomain } = require("../../utils/domains");
const pipelineState = require("../pipelineState");

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
const runEvaluationPipeline = async (job, profile, aiState) => {
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

module.exports = { getJobText, hasEntryLevelSignal, getSkipReason, getActiveProfile, runEvaluationPipeline };
