const { sendMail } = require('../mailer');

/**
 * Generate ticket email HTML template
 * @param {Object} order - The order object
 * @param {Object} event - The event object
 * @returns {string} HTML email template
 */
function generateTicketEmailHTML(order, event) {
  const ticketsList = order.tickets.map(ticket => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; font-weight: 500;">${ticket.name}</td>
      <td style="padding: 12px; text-align: center;">${ticket.quantity}</td>
      <td style="padding: 12px; text-align: right;">Rs${(ticket.price * ticket.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const eventDate = new Date(event.startDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const eventTime = new Date(event.startDate).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Ticketeer Tickets</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 32px 24px; text-align: center;">
          <div style="display: inline-flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 40px; height: 40px; background-color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <span style="font-weight: bold; font-size: 18px; color: #f97316;">T</span>
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: bold;">Ticketeer</h1>
          </div>
          <h2 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">Your Tickets Are Ready! 🎉</h2>
        </div>

        <!-- Content -->
        <div style="padding: 32px 24px;">
          <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
            Hi ${order.customerInfo.firstName},
          </p>
          
          <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
            Thank you for your purchase! Your tickets for <strong>${event.name}</strong> have been confirmed. 
            Here are your ticket details:
          </p>

          <!-- Event Details Card -->
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #f97316;">
            <h3 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #111827;">${event.name}</h3>
            <div style="display: grid; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 500; color: #6b7280;">📅 Date:</span>
                <span style="color: #374151;">${eventDate}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 500; color: #6b7280;">🕐 Time:</span>
                <span style="color: #374151;">${eventTime}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 500; color: #6b7280;">📍 Location:</span>
                <span style="color: #374151;">${event.venueName || event.location}</span>
              </div>
            </div>
          </div>

          <!-- Tickets Table -->
          <div style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">Your Tickets</h3>
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
              <thead>
                <tr style="background-color: #f9fafb;">
                  <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Ticket Type</th>
                  <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Quantity</th>
                  <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${ticketsList}
              </tbody>
            </table>
          </div>

          <!-- Order Summary -->
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #6b7280;">Order ID:</span>
              <span style="font-weight: 500; color: #374151;">${order._id}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #6b7280;">Subtotal:</span>
              <span style="color: #374151;">Rs${order.totalAmount.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #6b7280;">Service Fee:</span>
              <span style="color: #374151;">Rs${(order.totalAmount * 0.05).toFixed(2)}</span>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 12px 0;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #111827;">Total Paid:</span>
              <span style="font-weight: 600; color: #111827;">Rs${(order.totalAmount * 1.05).toFixed(2)}</span>
            </div>
          </div>

          <!-- Important Information -->
          <div style="background-color: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #92400e;">Important Information</h4>
            <ul style="margin: 0; padding-left: 20px; color: #92400e;">
              <li>Please bring a valid ID and this email confirmation to the event</li>
              <li>Tickets are non-refundable and non-transferable</li>
              <li>Arrive at least 30 minutes before the event starts</li>
              <li>Keep this email safe - it serves as your ticket</li>
            </ul>
          </div>

          <!-- Contact Information -->
          <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">
              Questions? Contact us at <a href="mailto:support@ticketeer.com" style="color: #f97316; text-decoration: none;">support@ticketeer.com</a>
            </p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">
              Thank you for choosing Ticketeer!
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #111827; padding: 24px; text-align: center;">
          <p style="margin: 0; color: #9ca3af; font-size: 12px;">
            © 2024 Ticketeer. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Send ticket confirmation email to customer
 * @param {Object} order - The order object
 * @param {Object} event - The event object
 * @returns {Promise} Email sending promise
 */
async function sendTicketEmail(order, event) {
  const html = generateTicketEmailHTML(order, event);
  
  return sendMail({
    to: order.customerInfo.email,
    subject: `Your Tickets for ${event.name} - Order #${order._id}`,
    html,
  });
}

module.exports = { sendTicketEmail };
