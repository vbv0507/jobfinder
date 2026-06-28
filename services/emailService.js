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

const sendMatchedJobEmail = async ({ company, job, analysis }) => {
  if (!hasEmailConfig()) {
    console.log("Email skipped: EMAIL_USER, EMAIL_PASS, or EMAIL_TO missing.");
    return false;
  }

  const transporter = createTransporter();
  const score = Number(analysis.score || 0);

  await transporter.sendMail({
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

  return true;
};

module.exports = {
  sendMatchedJobEmail,
};
