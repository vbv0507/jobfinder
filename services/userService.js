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

    if (!dbUser && email) {
        // Link existing email to new clerkId if they created a new Clerk account with same email
        dbUser = await User.findOne({ email });
        if (dbUser) {
            console.log(`[UserService] Linking existing email ${email} to new clerkId ${clerkId}`);
            dbUser.clerkId = clerkId;
        }
    }

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

            const isSuper = email && (email.toLowerCase().includes('vbvrai1407') || email.toLowerCase() === 'vbvrai1407@gmail.com');
            const role = isSuper ? 'admin' : 'viewer';

            newUser = new User({
                clerkId,
                email,
                fullName,
                imageUrl,
                role,
                viewAccess: 'granted',
                isActive: true,
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
            const isSuper = email && (email.toLowerCase().includes('vbvrai1407') || email.toLowerCase() === 'vbvrai1407@gmail.com');
            const role = isSuper ? 'admin' : 'viewer';
            dbUser = new User({
                clerkId,
                email,
                fullName,
                imageUrl,
                role,
                viewAccess: 'granted',
                isActive: true,
                lastLoginAt: now
            });
            try {
                await dbUser.save();
            } catch (err) {
                // If unique constraint violated, it was created concurrently OR email already exists
                if (err.code === 11000) {
                    dbUser = await User.findOne({ clerkId });
                    if (!dbUser) {
                        // Email collision?
                        dbUser = await User.findOne({ email });
                        if (dbUser) {
                            console.warn(`[UserService] Email collision for ${email}. Updating clerkId.`);
                            dbUser.clerkId = clerkId;
                            await dbUser.save();
                        } else {
                            throw new Error(`Unique constraint violation but user not found: ${err.message}`);
                        }
                    }
                } else {
                    throw err;
                }
            }
        }
    } finally {
        await session.endSession();
    }

    if (!dbUser) {
        throw new Error(`Failed to sync user: user could not be created or found.`);
    }

    return dbUser;
}

module.exports = {
    syncUser
};
