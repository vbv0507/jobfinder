/**
 * Feature Extraction Service
 * Pure deterministic parsing for ML data generation.
 * No AI, No ML.
 */

const extractExperienceYears = (text) => {
  const match = text.match(/(\d+)\s*(?:\+|-|to)\s*(?:\d+)?\s*(?:years?|yrs?)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
};

const extractSalaryBucket = (text) => {
  if (/(?:rs|inr|₹)?\s*([1-9][0-9]{5,})/i.test(text)) return 'High';
  if (/1[0-9]{2}k|200k/i.test(text)) return 'High';
  if (/[5-9][0-9]k/i.test(text)) return 'Medium';
  return 'Unknown';
};

const extractFeatures = (job) => {
  const text = [job.title, job.description, job.location, job.experience, job.employmentType].filter(Boolean).join(' ').toLowerCase();

  return {
    hasNodeJS: /\b(node\.?js|node)\b/.test(text),
    hasExpress: /\b(express\.?js|express)\b/.test(text),
    hasReact: /\b(react\.?js|react)\b/.test(text),
    hasNextJS: /\b(next\.?js|next)\b/.test(text),
    hasMongoDB: /\b(mongodb|mongo)\b/.test(text),
    hasRedis: /\b(redis)\b/.test(text),
    hasMySQL: /\b(mysql)\b/.test(text),
    hasPostgreSQL: /\b(postgresql|postgres)\b/.test(text),
    hasPython: /\b(python)\b/.test(text),
    hasJava: /\b(java)\b/.test(text),
    hasCPlusPlus: /\b(c\+\+|cpp)\b/.test(text),
    hasDocker: /\b(docker)\b/.test(text),
    hasKubernetes: /\b(kubernetes|k8s)\b/.test(text),
    hasAWS: /\b(aws|amazon web services)\b/.test(text),
    hasAzure: /\b(azure)\b/.test(text),
    hasGit: /\b(git|github|gitlab|bitbucket)\b/.test(text),
    hasRESTAPI: /\b(rest|restful|api)\b/.test(text),
    hasMicroservices: /\b(microservices|microservice)\b/.test(text),
    hasLinux: /\b(linux)\b/.test(text),
    isRemote: /\b(remote|work from home|wfh)\b/.test(text),
    isHybrid: /\b(hybrid)\b/.test(text),
    isOnsite: /\b(onsite|on-site|in office|in-office)\b/.test(text),
    isInternship: /\b(intern|internship)\b/.test(text),
    isFullTime: /\b(full-time|fulltime|full time)\b/.test(text),
    isContract: /\b(contract|contractor)\b/.test(text),
    experienceYears: extractExperienceYears(text),
    salaryBucket: extractSalaryBucket(text),
    companyTier: 'Unknown'
  };
};

module.exports = {
  extractFeatures
};
