const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    email: { type: String },
    role: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    endpoint: { type: String },
    action: { type: String, required: true },
    result: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
