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



const isLocationMatching = (job, profile) => {
  if (!STRICT_LOCATION_MATCH) return true;
  const preferred = (profile.preferredLocations || []).map(l => l.toLowerCase().trim()).filter(Boolean);
  if (preferred.length === 0) return true;

  const locStr = (job.location || "").toLowerCase().trim();
  const titleStr = (job.title || "").toLowerCase().trim();
  const fullLocText = `${locStr} ${titleStr}`;

  // 1. Explicit foreign / international country check (Disqualify non-India/non-Remote foreign roles)
  const isExplicitForeign = /\b(mexico|united states|usa|us|uk|united kingdom|london|canada|singapore|australia|germany|poland|netherlands|ireland|france|spain|sweden|switzerland|japan|dubai|uae|abu dhabi|brazil|israel|philippines|vietnam|taiwan|austria|nz|new zealand)\b/i.test(locStr);
  const isUsState = /\b(ca|ny|wa|tx|va|dc|fl|ma|il|co|nc|ga|nj|pa|oh|mi|az)\b/i.test(locStr);

  const isExplicitIndia = /\b(india|ind\b|in\b|bengaluru|bangalore|hyderabad|pune|noida|gurgaon|gurugram|delhi|mumbai|chennai|kolkata|ahmedabad|chandigarh|jaipur|raipur|kochi|cochin|indore)\b/i.test(fullLocText);
  const isGlobalOrIndiaRemote = /\b(remote\s*-\s*india|india,\s*remote|remote\s*\(india\)|remote,\s*india|india\s*remote|anywhere|global\s*remote)\b/i.test(fullLocText) || (locStr === 'remote');

  if (isExplicitIndia || isGlobalOrIndiaRemote) {
    return true;
  }

  if (isExplicitForeign || isUsState) {
    // If it's located in foreign territory (e.g. US, Mexico, UK) and not explicitly India or global remote, reject
    return false;
  }

  // Check candidate preferred location list
  const matchesPreferred = preferred.some(p => {
    if (p === 'india') return /\b(india|ind\b|in\b)\b/i.test(fullLocText);
    if (p === 'remote') return /\b(remote|wfh|work from home|anywhere)\b/i.test(fullLocText);
    const regex = new RegExp(`\\b${p}\\b`, 'i');
    return regex.test(fullLocText);
  });

  if (matchesPreferred) return true;

  // Fallback to description check with strict word boundaries
  const desc = (job.description || "").toLowerCase();
  const descIndia = /\b(location:\s*india|based in india|bengaluru|bangalore|hyderabad|pune|noida|gurugram|delhi|mumbai|chennai)\b/i.test(desc);
  const descRemote = /\b(100%\s*remote|fully\s*remote|work from anywhere)\b/i.test(desc);

  return descIndia || descRemote;
};

const getSkipReason = (job, profile) => {
  const text = getJobText(job);
  const preferredRoles = profile.preferredRoles || [];

  if (!isLocationMatching(job, profile)) {
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
  



  if (!aiState.openrouter) aiState.openrouter = { available: true };
  pipelineState.openrouterStatus = aiState.openrouter.available ? "Working" : "Unavailable";
  pipelineState.openrouterReason = aiState.openrouter.reason;
  pipelineState.openrouterRequests = aiState.openrouter.requests || 0;
  pipelineState.openrouterSuccess = aiState.openrouter.success || 0;
  pipelineState.openrouterFailed = aiState.openrouter.failed || 0;
  pipelineState.openrouterFallbacks = aiState.openrouterFallbacks || 0;
  pipelineState.openrouterDisabledAt = aiState.openrouter.disabledAt;
  
  pipelineState.localRequests = aiState.local?.requests || 0;
  pipelineState.localSuccess = aiState.local?.success || 0;
  pipelineState.localFailed = aiState.local?.failed || 0;

  if (!analysis || (analysis.errorCode && analysis.provider === "unknown")) {
    return { skipped: true, reason: "Evaluator failed for this job" };
  }

  return { skipped: false, analysis };
};

module.exports = { getJobText, hasEntryLevelSignal, getSkipReason, getActiveProfile, runEvaluationPipeline };
