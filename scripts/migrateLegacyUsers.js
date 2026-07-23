require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function migrateLegacyUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        // Find all users where the 'role' field does not exist
        const result = await User.updateMany(
            { role: { $exists: false } },
            { $set: { role: 'viewer' } }
        );

        console.log(`Migration Complete. Updated ${result.modifiedCount} legacy user documents.`);
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

migrateLegacyUsers();
