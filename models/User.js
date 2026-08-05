const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    clerkId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    fullName: {
        type: String
    },
    imageUrl: {
        type: String
    },
    role: {
        type: String,
        enum: ['admin', 'viewer'],
        required: true,
        default: 'viewer'
    },
    viewAccess: {
        type: String,
        enum: ['none', 'requested', 'granted'],
        default: 'none'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLoginAt: {
        type: Date
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
