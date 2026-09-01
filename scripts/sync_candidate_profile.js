require('dotenv').config();
const mongoose = require('mongoose');
const CandidateProfile = require('../models/CandidateProfile');
const profileData = require('../profile');

async function syncProfile() {
  console.log('[Sync Profile] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[Sync Profile] Connected.');

  const update = {
    ...profileData,
    active: true,
    updatedAt: new Date()
  };

  const updatedDoc = await CandidateProfile.findOneAndUpdate(
    { active: true },
    { $set: update },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('\n[Sync Profile] Successfully updated active CandidateProfile in MongoDB:');
  console.log('Candidate Name:', updatedDoc.name);
  console.log('Education:', updatedDoc.education);
  console.log('Graduation Year:', updatedDoc.graduationYear);
  console.log('Total Skills Count:', updatedDoc.skills?.length);
  console.log('Preferred Roles Count:', updatedDoc.preferredRoles?.length);
  console.log('Preferred Locations:', updatedDoc.preferredLocations?.join(', '));
  console.log('Preferred Domains:', updatedDoc.preferredDomains?.join(', '));
  console.log('Projects Count:', updatedDoc.projects?.length);
  console.log('Experience Count:', updatedDoc.experience?.length);
  console.log('Achievements Count:', updatedDoc.achievements?.length);

  await mongoose.disconnect();
}

syncProfile().catch(err => {
  console.error('[Sync Profile] Error:', err);
  process.exit(1);
});
