const CandidateProfile = require("../models/CandidateProfile");

const getActiveProfile = async (req, res) => {
    try {
        const profile = await CandidateProfile.findOne({ active: true })
            .sort({ updatedAt: -1 });

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
