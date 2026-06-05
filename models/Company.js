const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },

    careerUrl: {
        type: String,
        required: true,
    },

    category: {
        type: String,
        enum: ["Product", "Service"],
        required: true,
    },

    active: {
        type: Boolean,
        default: true,
    },

    scraperType: {
        type: String,
        enum: ["api"],
        default: "api",
    },

    scraperConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },

    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
