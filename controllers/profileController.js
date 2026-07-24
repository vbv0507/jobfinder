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
        await CandidateProfile.updateMany({}, { active: false });

        const profile = await CandidateProfile.create({
            ...req.body,
            active: true,
        });

        await logAuditAction(req, 'Candidate Edit', `Upserted profile ${profile._id}`);

        res.status(201).json({
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

module.exports = {
    getActiveProfile,
    upsertProfile,
};
