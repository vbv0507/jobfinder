const mongoose = require("mongoose");

const candidateProfileSchema = new mongoose.Schema({
    name: String,

    graduationYear: Number,

    skills: [String],

    preferredRoles: [String],

    preferredLocations: [String],

    projects: [String],

    careerPreferences: [String],

    active: {
        type: Boolean,
        default: true,
    },
}, { timestamps: true });

candidateProfileSchema.index({ active: 1 });

module.exports = mongoose.model("CandidateProfile", candidateProfileSchema);
