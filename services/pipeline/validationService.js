const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasExcludedKeyword = (job, excludedKeywords = []) => {
  const titleText = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  const fullText = [job.title, job.experience, job.description].filter(Boolean).join(" ").toLowerCase();
  
  // Specific drop logic to yield descriptive reasons
  const expMatch = [...titleText.matchAll(/(\d+)\s*(?:\+|-|to)\s*(?:\d+)?\s*(?:years?|yrs?)/g)];
  if (expMatch.some((match) => Number(match[1]) >= 2)) {
      const highest = Math.max(...expMatch.map(m => Number(m[1])));
      return { passed: false, reason: `Requires ${highest}+ years experience` };
  }
  
  const highLevelMatch = titleText.match(/\b(sde|software engineer|engineer)\s+(ii|iii|iv|v|[2-9])\b/i);
  if (highLevelMatch) {
      return { passed: false, reason: `Seniority mismatch: ${highLevelMatch[0]}` };
  }
  
  const midLevelMatch = titleText.match(/\b(intermediate|mid.?level)\b/i);
  if (midLevelMatch) {
      return { passed: false, reason: `Seniority mismatch: ${midLevelMatch[0]}` };
  }

  for (const keyword of excludedKeywords) {
    const normalizedKeyword = keyword.toLowerCase().trim();
    const isExperienceRange = /\d+\s*(?:\+|-|to)\s*\d*/.test(normalizedKeyword);
    const text = isExperienceRange ? fullText : titleText;
    
    let matched = false;
    if (/^[a-z0-9]+$/.test(normalizedKeyword)) {
      matched = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`).test(text);
    } else {
      matched = text.includes(normalizedKeyword);
    }
    
    if (matched) {
        return { passed: false, reason: `Contains excluded keyword: "${keyword}"` };
    }
  }

  return { passed: true };
};

const hasTargetKeyword = (job, company) => {
  const targetKeywords = Array.isArray(company.targetKeywords) ? company.targetKeywords : [];
  const excludedKeywords = Array.isArray(company.excludedKeywords) ? company.excludedKeywords : [];
  
  const excludedCheck = hasExcludedKeyword(job, excludedKeywords);
  if (!excludedCheck.passed) return excludedCheck; // Return {passed: false, reason: "..."}
  
  if (targetKeywords.length === 0) return { passed: true };
  
  const text = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  const matchedTarget = targetKeywords.some((keyword) => text.includes(keyword.toLowerCase()));
  
  if (!matchedTarget) {
      return { passed: false, reason: `Title missing target keywords (e.g. ${targetKeywords[0] || 'none'})` };
  }
  
  return { passed: true };
};

const hasAllowedLocation = (job, company) => {
  const allowedLocations = company.targetLocations || [];
  
  if (allowedLocations.length === 0) {
      return { passed: true }; // No location constraints
  }

  const text = (job.location || "").toLowerCase();
  if (!text || text === "not specified") return { passed: true }; 
  
  const matchedLocation = allowedLocations.some((location) => text.includes(location.toLowerCase()));
  
  if (!matchedLocation) {
      return { passed: false, reason: `Location mismatch: '${job.location}' not in allowed list` };
  }
  
  return { passed: true };
};

const applyJobFilters = (jobs, company, droppedJobs = []) => {
  return jobs.filter((job) => {
    
    const locationCheck = hasAllowedLocation(job, company);
    if (!locationCheck.passed) {
      droppedJobs.push({ 
          company: company.companyName || company.name, 
          jobTitle: job.title || "Unknown", 
          reason: locationCheck.reason, 
          url: job.url || job.applyLink, 
          ats: company.ats || 'unknown', 
          validationStage: 'applyJobFilters' 
      });
      return false;
    }
    
    const keywordCheck = hasTargetKeyword(job, company);
    if (!keywordCheck.passed) {
      droppedJobs.push({ 
          company: company.companyName || company.name, 
          jobTitle: job.title || "Unknown", 
          reason: keywordCheck.reason, 
          url: job.url || job.applyLink, 
          ats: company.ats || 'unknown', 
          validationStage: 'applyJobFilters' 
      });
      return false;
    }
    
    return true;
  });
};

module.exports = {
  applyJobFilters,
  hasAllowedLocation,
  hasTargetKeyword,
  hasExcludedKeyword
};
