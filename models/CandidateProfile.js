const mongoose = require("mongoose");

const candidateProfileSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    linkedin: String,
    github: String,
    education: String,

    graduationYear: Number,

    skills: [String],

    preferredRoles: [String],

    // Enables an exact job-title allowlist for candidates who only want a focused search.
    strictRoleMatch: { type: Boolean, default: false },
    roleAllowlist: [String],
    roleDenylist: [String],
    profileVersion: String,

    preferredLocations: [String],

    projects: [String],

    experience: [String],

    achievements: [String],

    careerPreferences: [String],

    careerStage: String,

    yearsOfExperience: Number,

    preferredDomains: [String],

    excludedDomains: [String],

    preferredEmploymentLevels: [String],

    preferredJobTypes: [String],

    active: {
        type: Boolean,
        default: true,
    },
}, { timestamps: true });

candidateProfileSchema.index({ active: 1 });

module.exports = mongoose.model("CandidateProfile", candidateProfileSchema);
