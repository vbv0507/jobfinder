const CandidateProfile = require("../models/CandidateProfile");
const { logAuditAction } = require("../services/auditService");

const getActiveProfile = async (req, res) => {
    try {
        let profile = await CandidateProfile.findOne({ active: true }).sort({ updatedAt: -1 });
        
        if (!profile) {
            profile = await CandidateProfile.create({
                name: "Default Candidate",
                active: true,
                preferredDomains: ["SOFTWARE_ENGINEERING"],
                yearsOfExperience: 0
            });
        }

        res.status(200).json({
            success: true,
            profile,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

const upsertProfile = async (req, res) => {
    try {
        const updateData = {
            ...req.body,
            active: true,
            updatedAt: new Date()
        };

        let profile = await CandidateProfile.findOneAndUpdate(
            { active: true },
            { $set: updateData },
            { upsert: true, returnDocument: "after" }
        );

        await logAuditAction(req, 'Candidate Edit', `Upserted candidate profile for ${profile.name}`);

        res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            profile,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

module.exports = {
    getActiveProfile,
    upsertProfile,
};
