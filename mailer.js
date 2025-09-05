const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/**

 * @param {Object} options
 * @param {string} options.to 
 * @param {string} options.subject
 * @param {string} options.html 
 * @returns {Promise}
 */
function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
