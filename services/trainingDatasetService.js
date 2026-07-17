const TrainingDataset = require('../models/TrainingDataset');
const { extractFeatures } = require('./featureExtractionService');

const mapRecommendationToLabel = (recommendation) => {
  if (!recommendation) return 1;
  const lower = recommendation.toLowerCase();
  if (lower.includes('apply') || lower.includes('highly recommended') || lower.includes('consider applying') || lower.includes('strong')) return 2;
  if (lower.includes('not recommended') || lower.includes('reject')) return 0;
  return 1;
};

const saveTrainingSample = async (job, company, analysis, pipelineId, triggerSource) => {
  try {
    if (!job.jobId || !job.title || !analysis.provider || analysis.score === undefined || !analysis.recommendation) {
      console.log(`[TrainingDataset] Validation Error: Missing required fields for job: ${job.title || 'Unknown'}`);
      return;
    }

    const providerUsed = analysis.provider;
    const aiScore = Number(analysis.score) || 0;
    const recommendation = analysis.recommendation;
    const label = mapRecommendationToLabel(recommendation);

    const features = extractFeatures(job);
    
    // In javascript, if an object doesn't have a property, it's undefined. We can fallback to 'Unknown' or just leave undefined
    // For Mongoose, undefined fields are skipped or take default values.
    const companyName = company ? company.name : (job.inferredCompany || 'Unknown');

    const datasetEntry = {
      jobId: job.jobId,
      companyId: company ? company._id : null,
      companyName: companyName,
      title: job.title,
      description: job.description,
      location: job.location,
      country: job.country || 'Unknown',
      workMode: job.workMode || 'Unknown',
      employmentType: job.employmentType,
      experience: job.experience,
      salary: job.salary,
      department: job.department,
      source: job.sourceName || job.sourceChannel || 'Unknown',
      originalJobUrl: job.applyLink,
      postedDate: job.postedAt,
      scrapedAt: new Date(),
      pipelineId: pipelineId || 'Unknown',
      triggerSource: triggerSource || 'Unknown',
      evaluatedAt: new Date(),

      rawSnapshot: {
        title: job.title,
        description: job.description,
        skills: job.skills || '',
        requirements: job.requirements || '',
        benefits: job.benefits || '',
        company: companyName,
        location: job.location
      },

      features,

      aiEvaluation: {
        providerUsed,
        providersAttempted: analysis.evaluationMetrics && analysis.evaluationMetrics.provider ? [analysis.evaluationMetrics.provider] : [providerUsed],
        providerModel: analysis.model || 'unknown',
        aiScore,
        confidence: analysis.confidence || 'Low',
        label,
        recommendation,
        evaluationTimeMs: analysis.evaluationTimeMs || 0,
        fallbackCount: analysis.fallbackCount || 0,
        reasonSummary: (analysis.reason || '').substring(0, 300)
      },

      feedback: {
        userAction: null,
        feedbackSource: 'AI'
      },

      datasetVersion: 1,
      featureVersion: 1
    };

    // Use updateOne with upsert and setOnInsert to prevent modifying existing historical samples
    await TrainingDataset.updateOne(
      { jobId: job.jobId, 'aiEvaluation.providerUsed': providerUsed, datasetVersion: 1 },
      { $setOnInsert: datasetEntry },
      { upsert: true }
    );

    console.log(`[TrainingDataset] Company: ${companyName} | Provider: ${providerUsed} | Model: ${datasetEntry.aiEvaluation.providerModel} | Score: ${aiScore} | Recommendation: ${recommendation} | Dataset Version: 1 | Sample Saved`);
  } catch (error) {
    if (error.code !== 11000) {
        console.log(`[TrainingDataset Error] Failed to save sample for ${job.title}: ${error.message}`);
    }
  }
};

module.exports = {
  saveTrainingSample
};
