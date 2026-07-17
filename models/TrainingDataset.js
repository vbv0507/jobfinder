const mongoose = require('mongoose');

const trainingDatasetSchema = new mongoose.Schema({
  // A. Job Metadata
  jobId: { type: String, required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  companyName: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  location: { type: String },
  country: { type: String },
  workMode: { type: String },
  employmentType: { type: String },
  experience: { type: String },
  salary: { type: String },
  department: { type: String },
  source: { type: String },
  originalJobUrl: { type: String },
  postedDate: { type: Date },
  scrapedAt: { type: Date },
  pipelineId: { type: String },
  triggerSource: { type: String },
  evaluatedAt: { type: Date },

  // B. Raw Job Snapshot
  rawSnapshot: {
    title: { type: String },
    description: { type: String },
    skills: { type: String },
    requirements: { type: String },
    benefits: { type: String },
    company: { type: String },
    location: { type: String }
  },

  // C. Engineered Features
  features: {
    hasNodeJS: { type: Boolean, default: false },
    hasExpress: { type: Boolean, default: false },
    hasReact: { type: Boolean, default: false },
    hasNextJS: { type: Boolean, default: false },
    hasMongoDB: { type: Boolean, default: false },
    hasRedis: { type: Boolean, default: false },
    hasMySQL: { type: Boolean, default: false },
    hasPostgreSQL: { type: Boolean, default: false },
    hasPython: { type: Boolean, default: false },
    hasJava: { type: Boolean, default: false },
    hasCPlusPlus: { type: Boolean, default: false },
    hasDocker: { type: Boolean, default: false },
    hasKubernetes: { type: Boolean, default: false },
    hasAWS: { type: Boolean, default: false },
    hasAzure: { type: Boolean, default: false },
    hasGit: { type: Boolean, default: false },
    hasRESTAPI: { type: Boolean, default: false },
    hasMicroservices: { type: Boolean, default: false },
    hasLinux: { type: Boolean, default: false },
    isRemote: { type: Boolean, default: false },
    isHybrid: { type: Boolean, default: false },
    isOnsite: { type: Boolean, default: false },
    isInternship: { type: Boolean, default: false },
    isFullTime: { type: Boolean, default: false },
    isContract: { type: Boolean, default: false },
    experienceYears: { type: Number, default: 0 },
    salaryBucket: { type: String },
    companyTier: { type: String }
  },

  // D. AI Evaluation Snapshot
  aiEvaluation: {
    providerUsed: { type: String, required: true },
    providersAttempted: [{ type: String }],
    providerModel: { type: String },
    aiScore: { type: Number, required: true },
    confidence: { type: String },
    label: { type: Number, required: true }, // 0 = Reject, 1 = Maybe, 2 = Apply
    recommendation: { type: String, required: true },
    evaluationTimeMs: { type: Number },
    fallbackCount: { type: Number },
    reasonSummary: { type: String } // maximum ~300 characters
  },

  // E. Human Feedback Preparation
  feedback: {
    userAction: { 
      type: String, 
      enum: ['Applied', 'Saved', 'Rejected', 'Ignored', 'Viewed', 'NotViewed', null], 
      default: null 
    },
    feedbackSource: { type: String, default: 'AI' } // AI, User, System
  },

  // F. Dataset Versioning
  datasetVersion: { type: Number, default: 1 },
  featureVersion: { type: Number, default: 1 }
}, {
  timestamps: true // adds createdAt, updatedAt
});

// G. Duplicate Prevention
trainingDatasetSchema.index({ jobId: 1, 'aiEvaluation.providerUsed': 1, datasetVersion: 1 }, { unique: true });

module.exports = mongoose.model('TrainingDataset', trainingDatasetSchema);
