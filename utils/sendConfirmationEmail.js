const jwt = require('jsonwebtoken');
const { sendMail } = require('../mailer');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function sendConfirmationEmail(user) {
  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  const url = `${BASE_URL}/api/auth/confirm/${token}`;
  const html = `
    <h2>Welcome to Ticketeer!</h2>
    <p>Please confirm your email by clicking the link below:</p>
    <a href="${url}">${url}</a>
    <p>If you did not sign up, you can ignore this email.</p>
  `;
  await sendMail({
    to: user.email,
    subject: 'Confirm your Ticketeer account',
    html,
  });
}

module.exports = { sendConfirmationEmail };
