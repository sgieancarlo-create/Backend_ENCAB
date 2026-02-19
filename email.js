/**
 * Send email via Gmail SMTP (nodemailer).
 * Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.
 * For Gmail: enable 2FA and create an App Password at https://myaccount.google.com/apppasswords
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Gmail not configured: set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Send an email.
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} text - Plain text body
 * @param {string} [html] - Optional HTML body
 * @param {{ filename: string, content: Buffer }} [attachment] - Optional attachment
 */
async function sendMail({ to, subject, text, html, attachment }) {
  const transport = getTransporter();
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to,
    subject,
    text: text || (html ? html.replace(/<[^>]+>/g, '') : ''),
    html: html || undefined,
    attachments: attachment ? [{ filename: attachment.filename, content: attachment.content }] : [],
  };
  const info = await transport.sendMail(mailOptions);
  return info;
}

module.exports = { sendMail, getTransporter };
