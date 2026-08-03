const nodemailer = require("nodemailer");

const hasEmailConfig = () =>
  Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.EMAIL_TO);

const createTransporter = () =>
  nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

const sendMatchedJobEmail = async ({ company, job, analysis, pipelineId = "Unknown", isDuplicate = false }) => {
  console.log(`[Email] Queued | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
  if (isDuplicate) {
    console.log(`[Email] Duplicate Job | Email skipped intentionally | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
    return false;
  }

  if (!hasEmailConfig()) {
    console.log(`[Email] Skipped | Reason: Missing EMAIL_USER, EMAIL_PASS, or EMAIL_TO config | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
    return false;
  }

  if (!job.applyLink || typeof job.applyLink !== 'string' || !job.applyLink.startsWith('http')) {
    console.log(`[Email] Invalid Email | Reason: Invalid or missing applyLink | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
    return false;
  }

  const transporter = createTransporter();
  const score = Number(analysis.score || 0);

  console.log(`[Email] Sending | Recipient: ${process.env.EMAIL_TO} | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);

  try {
    const info = await transporter.sendMail({
      from: `"AI Job Finder" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: `New matched job: ${job.title} at ${company.name}`,
      text: [
        `New matched job found`,
        ``,
        `Company: ${company.name}`,
        `Role: ${job.title}`,
        `Location: ${job.location || "Not specified"}`,
        `Score: ${score}`,
        `Match: ${analysis.roleMatch || "Profile aligned"}`,
        `Reason: ${analysis.reason || "AI selected this job"}`,
        ``,
        `Apply: ${job.applyLink}`,
      ].join("\n"),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>New matched job found</h2>
          <p><strong>Company:</strong> ${company.name}</p>
          <p><strong>Role:</strong> ${job.title}</p>
          <p><strong>Location:</strong> ${job.location || "Not specified"}</p>
          <p><strong>Score:</strong> ${score}</p>
          <p><strong>Match:</strong> ${analysis.roleMatch || "Profile aligned"}</p>
          <p><strong>Reason:</strong> ${analysis.reason || "AI selected this job"}</p>
          <p><a href="${job.applyLink}" target="_blank">Apply Now</a></p>
        </div>
      `,
    });
    
    console.log(`[Email] Sent | Message ID: ${info.messageId} | Recipient: ${process.env.EMAIL_TO} | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
    return true;
  } catch (err) {
    console.error(`[Email] SMTP Failed | Reason: ${err.message} | Recipient: ${process.env.EMAIL_TO} | Job: ${job.title} | Company: ${company.name} | Pipeline ID: ${pipelineId}`);
    throw err;
  }
};

const sendDailyDigestEmail = async (atsJobs, telegramJobs) => {
  if (!hasEmailConfig() || (atsJobs.length === 0 && telegramJobs.length === 0)) return false;

  const transporter = createTransporter();
  const totalJobs = atsJobs.length + telegramJobs.length;
  console.log(`[Email] Sending Daily Digest | Recipient: ${process.env.EMAIL_TO} | Total Count: ${totalJobs}`);

  const renderJobCard = (job) => `
    <div style="border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 5px;">
      <p><strong>Provider:</strong> ${job.provider}</p>
      <p><strong>Company:</strong> ${job.company?.name || 'Unknown'}</p>
      <p><strong>Role:</strong> ${job.role || job.rawJob?.title || 'Unknown'}</p>
      <p><strong>Location:</strong> ${job.location || "Not specified"}</p>
      <p><strong>Apply Link:</strong> <a href="${job.applyLink || job.rawJob?.applyLink}" target="_blank">Apply Now</a></p>
      <p><strong>Reason Match:</strong> ${job.reason}</p>
      <p><strong>Match Score:</strong> ${job.score}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"AI Job Finder" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject: `Daily Match Digest: ${totalJobs} new jobs found`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Daily Job Matches (${totalJobs})</h2>
          
          ${atsJobs.length > 0 ? `
            <h3>ATS Jobs (${atsJobs.length})</h3>
            ${atsJobs.map(renderJobCard).join('')}
          ` : ''}

          ${telegramJobs.length > 0 ? `
            <h3>Telegram Jobs (${telegramJobs.length})</h3>
            ${telegramJobs.map(renderJobCard).join('')}
          ` : ''}
        </div>
      `,
    });
    
    console.log(`[Email] Daily Digest Sent | Message ID: ${info.messageId} | Recipient: ${process.env.EMAIL_TO}`);
    return true;
  } catch (err) {
    console.error(`[Email] Daily Digest SMTP Failed | Reason: ${err.message} | Recipient: ${process.env.EMAIL_TO}`);
    throw err;
  }
};

const processBatchEmail = async () => {
  try {
    const MatchedJob = require('../models/MatchedJob');
    const jobs = await MatchedJob.find({
      emailEligible: true,
      emailSent: false,
      provider: { $regex: /^(?!local).*/i }
    })
    .populate('company')
    .populate('rawJob')
    .exec();
    
    if (jobs.length > 0) {
      const atsJobs = [];
      const telegramJobs = [];

      jobs.forEach(job => {
        // If rawJob has sourceChannel or telegramMessageId, it's a telegram job
        if (job.rawJob && (job.rawJob.sources?.length > 0 || job.rawJob.sourceChannel)) {
          telegramJobs.push(job);
        } else {
          atsJobs.push(job);
        }
      });

      const success = await sendDailyDigestEmail(atsJobs, telegramJobs);
      if (success) {
        await MatchedJob.updateMany(
          { _id: { $in: jobs.map(j => j._id) } }, 
          { $set: { emailSent: true, emailSentAt: new Date(), emailed: true } }
        );
        console.log(`[Email] Marked ${jobs.length} jobs as emailSent.`);
      }
    } else {
      console.log(`[Email] No verified jobs to email in daily digest.`);
    }
  } catch (err) {
    console.error(`[Email] Error processing daily digest email:`, err);
  }
};

module.exports = {
  sendMatchedJobEmail,
  sendDailyDigestEmail,
  processBatchEmail
};
