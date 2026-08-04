require('dotenv').config();
const { evaluateJob } = require('../services/geminiService');
const { getJobText } = require('../services/pipeline/aiEvaluationService');
const fallbackProfile = require('../profile.js');

const aiState = {
    calls: 0,
    quotaExceeded: false,
    gemini: { available: true, requests: 0, success: 0, failed: 0, reason: null, disabledAt: null },
    groq:   { available: true, requests: 0, success: 0, failed: 0, reason: null, disabledAt: null },
    local:  { requests: 0, success: 0, failed: 0 },
    geminiFallbacks: 0,
    groqFallbacks:   0,
};

const job = {
    title: 'Software Engineer',
    location: 'Bangalore',
    experience: null,
    description: 'Salesforce - Software Engineer role',
    employmentType: 'Full-Time'
};

console.log('Testing evaluateJob...');
evaluateJob(job, fallbackProfile, aiState)
    .then(result => {
        console.log('--- RESULT ---');
        console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
        console.error('--- ERROR ---');
        console.error(err);
    });
