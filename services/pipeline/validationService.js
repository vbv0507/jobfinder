const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasRequiredFields = (job) => {
  if (!job.title || job.title.length < 3) return { passed: false, reason: "Missing or invalid title" };
  if (!job.applyLink && !job.url) return { passed: false, reason: "Missing apply link" };
  return { passed: true };
};

const hasAllowedLocation = (job, company) => {
  const allowedLocations = company.targetLocations || [];
  const validLocations = allowedLocations.filter(loc => loc && typeof loc === 'string' && loc.trim() !== '');
  
  if (validLocations.length === 0) {
      return { passed: true }; // No location constraints
  }

  const rawText = (job.location || "").toLowerCase();
  if (!rawText || rawText === "not specified") return { passed: true }; 
  
  const normalizeLocationString = (locStr) => {
    let str = locStr.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const usStates = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy'];
    const words = str.split(/\s+/).filter(Boolean);
    if (words.some(w => usStates.includes(w)) && !words.includes('us') && !words.includes('united') && !words.includes('states')) {
        str += " us";
    }
    // City aliases: normalize common alternate spellings to canonical form
    const cityAliases = {
      'gurugram': 'gurgaon',
      'bengaluru': 'bangalore',
      'bombay': 'mumbai',
      'calcutta': 'kolkata',
      'madras': 'chennai',
    };
    for (const [alias, canonical] of Object.entries(cityAliases)) {
      str = str.replace(new RegExp(`\\b${alias}\\b`, 'g'), canonical);
    }
    return str.trim();
  };

  
  const normalizedJobLocation = normalizeLocationString(rawText);
  
  const matchedLocation = validLocations.some((location) => {
      const target = normalizeLocationString(location);
      return normalizedJobLocation.includes(target);
  });
  
  if (!matchedLocation) {
      return { passed: false, reason: `Location mismatch: '${job.location}' not in allowed list` };
  }
  
  return { passed: true };
};

const hasAllowedEmploymentType = (job) => {
  // Reserved for explicit employment type checks (e.g. Intern, Contract) if company config requires it.
  return { passed: true }; 
};

const hasAllowedExperience = (job) => {
  const titleText = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  
  const isFresherSignal = /\b(intern|internship|fresher|new grad|entry level|campus|trainee|junior|associate|sde-?1|sde-?i|software development engineer i\b)\b/i.test(titleText);
  
  if (isFresherSignal) {
      return { passed: true };
  }

  const expMatch = [...titleText.matchAll(/(\d+)\s*(?:\+|-|to)\s*(?:\d+)?\s*(?:years?|yrs?)/g)];
  if (expMatch.some((match) => Number(match[1]) >= 3)) {
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
  
  // Inspect description for explicit mandatory qualifications (e.g. Amazon "3+ years of non-internship professional experience")
  const desc = (job.description || "").toLowerCase();
  const descExpMatches = [...desc.matchAll(/(?:basic qualifications?|minimum qualifications?|requirements?|qualifications?|must have)[^]{0,400}?(\d+)\+?\s*years?\s*(?:of)?\s*(?:[a-z-]+\s+){0,6}experience/gi)];
  const directExpMatches = [...desc.matchAll(/(\d+)\+?\s*years?\s*(?:of)?\s*(?:non-internship|relevant|hands-on|industry|professional|software|development|engineering|work)\s*(?:[a-z-]+\s+){0,5}experience/gi)];
  const allExp = [...descExpMatches, ...directExpMatches].map(m => Number(m[1])).filter(n => Number.isFinite(n));

  if (allExp.some(n => n >= 3)) {
      const highest = Math.max(...allExp);
      return { passed: false, reason: `Requires ${highest}+ years experience (from qualifications)` };
  }

  return { passed: true };
};

const hasExcludedKeyword = (job, excludedKeywords = []) => {
  const titleText = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  const fullText = [job.title, job.experience, job.description].filter(Boolean).join(" ").toLowerCase();
  
  for (const keyword of excludedKeywords) {
    if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') continue;
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
  
  const validTargets = targetKeywords.filter(k => k && typeof k === 'string' && k.trim() !== '');
  if (validTargets.length === 0) return { passed: true };
  
  const text = [job.title, job.experience].filter(Boolean).join(" ").toLowerCase();
  const matchedTarget = validTargets.some((keyword) => text.includes(keyword.toLowerCase().trim()));
  
  if (!matchedTarget) {
      return { passed: false, reason: `Title missing target keywords (e.g. ${validTargets[0]})` };
  }
  
  return { passed: true };
};

const hasAllowedDomain = (job, company) => {
  // Reserved for explicit domain checks (e.g. "Fintech", "Healthcare") if required.
  return { passed: true };
};

const normalizeTitle = (title) => {
  if (!title) return "";
  let clean = title.replace(/<(?:.|\n)*?>/gm, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  clean = clean.replace(/(\s*-\s*|\s*\|?\s*)(apply(?: now)?|see role|read more|learn more)\s*$/i, '');
  if (/^(apply(?: now)?|see role|read more|learn more|click here)$/i.test(clean)) return "";
  return clean;
};

const normalizeLocation = (loc) => {
  if (!loc) return "";
  return loc.replace(/<(?:.|\n)*?>/gm, ' ').replace(/\s+/g, ' ').trim();
};

const applyJobFilters = (jobs, company, droppedJobs = []) => {
  const uniqueJobs = new Map();
  
  // Scraper output normalization
  jobs.forEach(job => {
    job.title = normalizeTitle(job.title);
    job.location = normalizeLocation(job.location);
    
    // Deduplication (Phase 4 Sequence: Scraper -> Duplicate)
    const dedupKey = `${job.title.toLowerCase()}||${job.location.toLowerCase()}`;
    if (!uniqueJobs.has(dedupKey)) {
        uniqueJobs.set(dedupKey, job);
    } else {
       droppedJobs.push({ 
           company: company.companyName || company.name, 
           jobTitle: job.title, 
           location: job.location,
           applyLink: job.url || job.applyLink,
           reason: "Duplicate job within same scrape", 
           validator: "duplicate_validator",
           validationStage: "Duplicate" 
       });
    }
  });

  return Array.from(uniqueJobs.values()).filter((job) => {
    
    // 1. Required Fields
    const reqCheck = hasRequiredFields(job);
    if (!reqCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasRequiredFields", validationStage: "Required Fields", reason: reqCheck.reason });
      return false;
    }
    
    // 2. Location
    const locCheck = hasAllowedLocation(job, company);
    if (!locCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasAllowedLocation", validationStage: "Location", reason: locCheck.reason });
      return false;
    }
    
    // 3. Employment
    const empCheck = hasAllowedEmploymentType(job);
    if (!empCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasAllowedEmploymentType", validationStage: "Employment", reason: empCheck.reason });
      return false;
    }
    
    // 4. Experience
    const expCheck = hasAllowedExperience(job);
    if (!expCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasAllowedExperience", validationStage: "Experience", reason: expCheck.reason });
      return false;
    }
    
    // 5. Keyword (Target)
    const targetKwCheck = hasTargetKeyword(job, company);
    if (!targetKwCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasTargetKeyword", validationStage: "Keyword", reason: targetKwCheck.reason });
      return false;
    }
    
    // 6. Keyword (Excluded)
    const excludedKwCheck = hasExcludedKeyword(job, Array.isArray(company.excludedKeywords) ? company.excludedKeywords : []);
    if (!excludedKwCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasExcludedKeyword", validationStage: "Excluded Keyword", reason: excludedKwCheck.reason });
      return false;
    }
    
    // 7. Domain
    const domCheck = hasAllowedDomain(job, company);
    if (!domCheck.passed) {
      droppedJobs.push({ company: company.name, jobTitle: job.title, location: job.location, applyLink: job.url || job.applyLink, validator: "hasAllowedDomain", validationStage: "Domain", reason: domCheck.reason });
      return false;
    }
    
    return true;
  });
};

module.exports = {
  applyJobFilters,
  hasRequiredFields,
  hasAllowedLocation,
  hasAllowedEmploymentType,
  hasAllowedExperience,
  hasTargetKeyword,
  hasExcludedKeyword,
  hasAllowedDomain
};
