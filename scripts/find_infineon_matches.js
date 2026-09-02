require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const InfineonAdapter = require('../services/ats/providers/Priority1/InfineonAdapter');
const { evaluateJob } = require('../services/geminiService');
const { getActiveProfile } = require('../services/pipeline/aiEvaluationService');
const fs = require('fs');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function findInfineonMatches() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.');

  const profile = await getActiveProfile();
  console.log(`\nCandidate: ${profile.name} | Grad: ${profile.graduationYear} | Exp: ${profile.yearsOfExperience} yrs`);
  console.log(`Target Roles: SDE, Backend, Full-Stack, AI, Intern, Trainee, New Grad`);

  const company = {
    name: 'Infineon Technologies',
    ats: 'infineon',
    careerUrl: 'https://jobs.infineon.com/careers?query=software&location=India&sort_by=relevance'
  };

  const adapter = new InfineonAdapter(company);
  const allJobs = await adapter.searchJobs();
  console.log(`\nTotal Live Infineon Jobs Scraped: ${allJobs.length}`);

  // Categorize jobs
  const seniorTitles = ['senior', 'staff', 'principal', 'lead', 'director', 'manager', 'architect', 'expert'];
  
  const categorized = allJobs.map(job => {
    const titleLower = job.title.toLowerCase();
    const descLower = (job.description || '').toLowerCase();
    const isSenior = seniorTitles.some(s => titleLower.includes(s));
    const isTraineeOrIntern = titleLower.includes('trainee') || titleLower.includes('intern') || titleLower.includes('graduate') || titleLower.includes('junior') || titleLower.includes('associate') || titleLower.includes('entry');
    const isSoftwareOrTech = titleLower.includes('software') || titleLower.includes('developer') || titleLower.includes('ai') || titleLower.includes('python') || titleLower.includes('engineer') || titleLower.includes('embedded') || titleLower.includes('system');
    
    let priority = 3; // Low (Senior/Hardware)
    if (isTraineeOrIntern && isSoftwareOrTech) priority = 1; // High (Trainee/Intern Tech)
    else if (!isSenior && isSoftwareOrTech) priority = 2; // Medium (Entry/Mid Software)
    else if (titleLower.includes('software') || titleLower.includes('developer') || titleLower.includes('ai')) priority = 2;

    return {
      job,
      priority,
      isSenior,
      isTraineeOrIntern,
      isSoftwareOrTech
    };
  });

  // Sort: Priority 1 first, then Priority 2, then Priority 3
  categorized.sort((a, b) => a.priority - b.priority);

  const highPriority = categorized.filter(c => c.priority <= 2);
  console.log(`\nFound ${highPriority.length} candidate-relevant roles (Trainee, Intern, Software, AI, Developer).`);

  const aiState = {
    gemini: { available: true, requests: 0, success: 0, failed: 0 },
    groq: { available: true, requests: 0, success: 0, failed: 0 },
    openrouter: { available: true, requests: 0, success: 0, failed: 0 },
    calls: 0
  };

  const evaluated = [];

  for (let i = 0; i < highPriority.length; i++) {
    const item = highPriority[i];
    const job = item.job;
    console.log(`\n[${i+1}/${highPriority.length}] Evaluating: "${job.title}" (${job.location})`);
    
    try {
      const evalResult = await evaluateJob(job, profile, aiState);
      evaluated.push({
        job,
        evaluation: evalResult,
        priority: item.priority
      });
      console.log(`   -> AI Score: ${evalResult.score}/100 | Recommendation: ${evalResult.recommendationLevel || evalResult.roleMatch} | Suitable: ${evalResult.suitable}`);
      console.log(`   -> Reason: ${evalResult.reason}`);
      if (evalResult.matchedSkills?.length) {
        console.log(`   -> Matched Skills: ${evalResult.matchedSkills.join(', ')}`);
      }
      if (evalResult.missingSkills?.length) {
        console.log(`   -> Missing Skills: ${evalResult.missingSkills.join(', ')}`);
      }
    } catch (err) {
      console.log(`   -> Evaluation error: ${err.message}`);
    }

    await sleep(800); // polite rate limit pause
  }

  // Sort evaluated by score
  evaluated.sort((a, b) => b.evaluation.score - a.evaluation.score);

  console.log('\n================================================================');
  console.log('              ALL INFINEON EVALUATION RESULTS FOR YOU           ');
  console.log('================================================================');

  evaluated.forEach((ev, idx) => {
    console.log(`\n#${idx + 1}. [Score: ${ev.evaluation.score}/100] ${ev.job.title}`);
    console.log(`    Location: ${ev.job.location}`);
    console.log(`    Job ID: ${ev.job.jobId}`);
    console.log(`    Apply Link: ${ev.job.applyLink || ev.job.url}`);
    console.log(`    Recommendation: ${ev.evaluation.recommendationLevel || 'Consider'}`);
    console.log(`    AI Rationale: ${ev.evaluation.reason}`);
    console.log(`    Strengths: ${(ev.evaluation.strengths || []).join(', ') || 'Solid fundamental alignment'}`);
    console.log(`    Weaknesses: ${(ev.evaluation.weaknesses || []).join(', ') || 'None critical'}`);
  });

  fs.writeFileSync('reports/infineon_candidate_matches.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidateName: profile.name,
    totalInfineonJobs: allJobs.length,
    evaluatedCount: evaluated.length,
    results: evaluated
  }, null, 2));

  console.log('\nResults saved to reports/infineon_candidate_matches.json');
  await mongoose.disconnect();
}

findInfineonMatches().catch(console.error);
