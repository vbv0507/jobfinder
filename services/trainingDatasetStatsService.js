const TrainingDataset = require('../models/TrainingDataset');

const getDatasetStats = async () => {
  try {
    const totalSamples = await TrainingDataset.countDocuments();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const samplesToday = await TrainingDataset.countDocuments({ createdAt: { $gte: today } });
    
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const samplesThisWeek = await TrainingDataset.countDocuments({ createdAt: { $gte: lastWeek } });
    
    const providerDist = await TrainingDataset.aggregate([
      { $group: { _id: "$aiEvaluation.providerUsed", count: { $sum: 1 } } }
    ]);
    
    const recDist = await TrainingDataset.aggregate([
      { $group: { _id: "$aiEvaluation.recommendation", count: { $sum: 1 } } }
    ]);
    
    const avgScoreResult = await TrainingDataset.aggregate([
      { $group: { _id: null, avgScore: { $avg: "$aiEvaluation.aiScore" } } }
    ]);
    
    const invalidSampleCount = await TrainingDataset.countDocuments({
      $or: [
        { jobId: { $exists: false } },
        { title: { $exists: false } }
      ]
    });

    return {
      totalSamples,
      samplesToday,
      samplesThisWeek,
      providerDistribution: providerDist.map(d => ({ provider: d._id, count: d.count })),
      recommendationDistribution: recDist.map(d => ({ recommendation: d._id, count: d.count })),
      averageAiScore: avgScoreResult.length > 0 ? Math.round(avgScoreResult[0].avgScore) : 0,
      invalidSampleCount,
      duplicateCount: 0 // Duplicates are prevented at schema level with unique indexes
    };
  } catch (error) {
    console.log(`[TrainingDatasetStatsService] Error getting stats: ${error.message}`);
    return null;
  }
};

module.exports = {
  getDatasetStats
};
