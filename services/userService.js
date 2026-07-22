const mongoose = require('mongoose');
const { clerkClient } = require('@clerk/express');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * Synchronizes the Clerk user to the MongoDB database.
 * If the user does not exist, they are created.
 * The first user created in the system gets the 'admin' role.
 * 
 * @param {string} clerkId - The Clerk User ID
 * @returns {Object} The MongoDB user object
 */
async function syncUser(clerkId) {
    let dbUser = await User.findOne({ clerkId });

    const now = new Date();
    // If user exists and synced in the last 24 hours, just update lastLoginAt locally without fetching from Clerk
    if (dbUser && dbUser.lastLoginAt && (now - dbUser.lastLoginAt) < 24 * 60 * 60 * 1000) {
        dbUser.lastLoginAt = now;
        await dbUser.save();
        await AuditLog.create({ action: 'User Login', user: dbUser.email, details: 'User logged in (cached)' }).catch(() => {});
        return dbUser;
    }

    // Fetch latest info from Clerk
    let clerkUser;
    try {
        clerkUser = await clerkClient.users.getUser(clerkId);
    } catch (e) {
        console.error(`[UserService] Failed to fetch Clerk user ${clerkId}:`, e.message);
        // If we have a local dbUser, just return it so the session doesn't completely break
        if (dbUser) return dbUser;
        throw e;
    }

    const email = clerkUser.emailAddresses[0]?.emailAddress;
    const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || email;
    const imageUrl = clerkUser.imageUrl;

    if (dbUser) {
        // Update returning user details (excluding role)
        dbUser.email = email;
        dbUser.fullName = fullName;
        dbUser.imageUrl = imageUrl;
        dbUser.lastLoginAt = now;
        await dbUser.save();
        await AuditLog.create({ action: 'User Login', user: dbUser.email, details: 'User logged in (cached)' }).catch(() => {});
        return dbUser;
    }

    // NEW USER: Atomic creation with first-admin logic
    const session = await mongoose.startSession();
    try {
        let newUser;
        await session.withTransaction(async () => {
            // Re-check inside transaction in case it was created concurrently
            let existing = await User.findOne({ clerkId }).session(session);
            if (existing) {
                newUser = existing;
                return;
            }

            const adminCount = await User.countDocuments({ role: 'admin' }).session(session);
            const role = adminCount === 0 ? 'admin' : 'viewer';

            newUser = new User({
                clerkId,
                email,
                fullName,
                imageUrl,
                role,
                lastLoginAt: now
            });
            await newUser.save({ session });
        });
        dbUser = newUser;
        await AuditLog.create({ action: 'User Login', user: dbUser.email, details: 'New user registered' }).catch(() => {});
    } catch (error) {
        console.warn('[UserService] Transaction failed, falling back to non-transactional creation:', error.message);
        
        // Fallback for standalone MongoDB instances without replica sets
        dbUser = await User.findOne({ clerkId });
        if (!dbUser) {
            const adminCount = await User.countDocuments({ role: 'admin' });
            const role = adminCount === 0 ? 'admin' : 'viewer';
            dbUser = new User({
                clerkId,
                email,
                fullName,
                imageUrl,
                role,
                lastLoginAt: now
            });
            try {
                await dbUser.save();
            } catch (err) {
                // If unique constraint violated, it was created concurrently
                if (err.code === 11000) {
                    dbUser = await User.findOne({ clerkId });
                } else {
                    throw err;
                }
            }
        }
    } finally {
        await session.endSession();
    }

    return dbUser;
}

module.exports = {
    syncUser
};
