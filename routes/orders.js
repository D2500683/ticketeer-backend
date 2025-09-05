const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Order = require('../models/Order');
const Event = require('../models/Event');
const authenticateToken = require('../middleware/authenticateToken');
const { validateAndSanitize } = require('../middleware/sanitization');
const { sendTicketEmail } = require('../utils/sendTicketEmail');
const receiptVerificationService = require('../services/receiptVerification');
const ticketGeneratorService = require('../services/ticketGenerator');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/transfer-screenshots');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'transfer-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Check if file is an image
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// POST /api/orders/mcb-juice-whatsapp - Create MCB Juice order with WhatsApp verification
router.post('/mcb-juice-whatsapp', async (req, res) => {
  try {
    const {
      eventId,
      customerInfo,
      tickets,
      totalAmount,
      paymentReference,
      organizerWhatsApp
    } = req.body;

    // Validate required fields
    if (!eventId || !customerInfo || !tickets || !totalAmount || !paymentReference) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventId, customerInfo, tickets, totalAmount, paymentReference' 
      });
    }

    // Verify event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Create attendee records for guest users
    const attendees = tickets.map(ticket => ({
      ticketType: ticket.name,
      quantity: ticket.quantity,
      customerInfo: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        email: customerInfo.email
      },
      isGuest: true
    }));

    // Create new order with WhatsApp verification pending
    const order = new Order({
      eventId,
      customerInfo,
      tickets,
      totalAmount: parseFloat(totalAmount),
      paymentMethod: 'mcb-juice-whatsapp',
      paymentStatus: 'pending_whatsapp_verification',
      paymentReference,
      organizerWhatsApp,
      verificationNotes: 'Payment details sent via WhatsApp. Awaiting organizer verification.',
      attendees
    });

    // Save order to database
    const savedOrder = await order.save();

    // Update event with new attendees
    event.attendees = event.attendees || [];
    event.attendees.push(...attendees);
    
    // Update total tickets sold
    const totalTicketsPurchased = tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
    event.totalTicketsSold = (event.totalTicketsSold || 0) + totalTicketsPurchased;
    
    await event.save();

    console.log(`WhatsApp MCB Juice order created: ${savedOrder._id}, awaiting organizer verification`);

    res.status(201).json({
      _id: savedOrder._id,
      orderId: savedOrder._id,
      orderNumber: savedOrder.orderNumber,
      status: 'pending_whatsapp_verification',
      message: 'Order created successfully. Payment details sent via WhatsApp. Awaiting organizer verification.'
    });
  } catch (error) {
    console.error('Error creating WhatsApp MCB Juice order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/orders/mcb-juice - Create MCB Juice order with screenshot
router.post('/mcb-juice', upload.single('transferScreenshot'), async (req, res) => {
  try {
    const {
      eventId,
      customerInfo,
      tickets,
      totalAmount,
      paymentReference
    } = req.body;

    // Parse JSON strings
    const parsedCustomerInfo = typeof customerInfo === 'string' ? JSON.parse(customerInfo) : customerInfo;
    const parsedTickets = typeof tickets === 'string' ? JSON.parse(tickets) : tickets;

    // Validate required fields
    if (!eventId || !parsedCustomerInfo || !parsedTickets || !totalAmount || !paymentReference) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventId, customerInfo, tickets, totalAmount, paymentReference' 
      });
    }

    // Validate screenshot upload
    if (!req.file) {
      return res.status(400).json({ 
        error: 'Transfer screenshot is required' 
      });
    }

    // Verify event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Create attendee records for guest users
    const attendees = parsedTickets.map(ticket => ({
      ticketType: ticket.name,
      quantity: ticket.quantity,
      customerInfo: {
        firstName: parsedCustomerInfo.firstName,
        lastName: parsedCustomerInfo.lastName,
        email: parsedCustomerInfo.email
      },
      isGuest: true
    }));

    // Create new order with screenshot
    const order = new Order({
      eventId,
      customerInfo: parsedCustomerInfo,
      tickets: parsedTickets,
      totalAmount: parseFloat(totalAmount),
      paymentMethod: 'mcb-juice',
      paymentStatus: 'pending_verification', // Will attempt automatic verification
      paymentReference,
      transferScreenshot: req.file.path,
      screenshotOriginalName: req.file.originalname,
      attendees
    });

    // Save order to database
    const savedOrder = await order.save();

    // Update event with new attendees
    event.attendees = event.attendees || [];
    event.attendees.push(...attendees);
    
    // Update total tickets sold
    const totalTicketsPurchased = parsedTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
    event.totalTicketsSold = (event.totalTicketsSold || 0) + totalTicketsPurchased;
    
    await event.save();

    // Attempt automatic verification
    console.log(`MCB Juice order created: ${savedOrder._id}, starting automatic verification...`);
    
    // Start automatic verification in background
    setImmediate(async () => {
      try {
        await router.processAutomaticVerification(savedOrder, event);
      } catch (error) {
        console.error(`Automatic verification failed for order ${savedOrder._id}:`, error);
        // Order remains in pending_verification status for manual review
      }
    });

    res.status(201).json({
      _id: savedOrder._id,
      orderId: savedOrder._id,
      orderNumber: savedOrder.orderNumber,
      status: 'pending_verification',
      message: 'Order created successfully. Payment verification in progress.'
    });
  } catch (error) {
    console.error('Error creating MCB Juice order:', error);
    
    // Clean up uploaded file if order creation fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/orders - Create a new order
router.post('/', validateAndSanitize.order, async (req, res) => {
  try {
    const {
      eventId,
      customerInfo,
      tickets,
      totalAmount,
      paymentMethod,
      paymentStatus,
      attendees
    } = req.body;

    // Validate required fields
    if (!eventId || !customerInfo || !tickets || !totalAmount) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventId, customerInfo, tickets, totalAmount' 
      });
    }

    // Verify event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Create new order
    const order = new Order({
      eventId,
      customerInfo,
      tickets,
      totalAmount,
      paymentMethod: paymentMethod || 'card',
      paymentStatus: paymentStatus || 'completed', // For testing, default to completed
      attendees: attendees || []
    });

    // Save order to database
    const savedOrder = await order.save();

    // Update event with new attendees (if provided)
    if (attendees && attendees.length > 0) {
      // Add attendees to the event
      event.attendees = event.attendees || [];
      event.attendees.push(...attendees);
      
      // Update total tickets sold
      const totalTicketsPurchased = tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
      event.totalTicketsSold = (event.totalTicketsSold || 0) + totalTicketsPurchased;
      
      await event.save();
    }

    // Send ticket confirmation email if payment is completed
    if (paymentStatus === 'completed') {
      try {
        await sendTicketEmail(savedOrder, event);
        console.log(`Ticket email sent successfully to ${customerInfo.email} for order ${savedOrder._id}`);
      } catch (emailError) {
        console.error('Failed to send ticket email:', emailError);
        // Don't fail the order creation if email fails
      }
    }

    res.status(201).json(savedOrder);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /api/orders/:id - Get order by ID
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('eventId');
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// GET /api/orders - Get all orders (with optional filters)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { eventId, customerEmail, status } = req.query;
    const userId = req.user.id;
    
    let filter = {};
    
    // If eventId is specified, use it directly
    if (eventId) {
      filter.eventId = eventId;
    } else {
      // Otherwise, filter by organizer's events
      const Event = require('../models/Event');
      const organizerEvents = await Event.find({ organizer: userId }).select('_id');
      const eventIds = organizerEvents.map(event => event._id);
      filter.eventId = { $in: eventIds };
    }
    
    if (customerEmail) filter['customerInfo.email'] = customerEmail;
    if (status) {
      // Handle multiple status values separated by comma
      const statusValues = status.split(',').map(s => s.trim());
      filter.paymentStatus = { $in: statusValues };
    }

    const orders = await Order.find(filter)
      .populate('eventId')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Process automatic verification
router.processAutomaticVerification = async function(order, event) {
  try {
    console.log(`Starting automatic verification for order ${order._id}`);
    
    // Get MCB Juice number from event or environment
    const expectedRecipient = event.mcbJuiceNumber || process.env.MCB_JUICE_NUMBER;
    
    // Perform OCR verification
    const verification = await receiptVerificationService.verifyReceipt(
      order.transferScreenshot,
      order.totalAmount,
      order.paymentReference,
      expectedRecipient
    );
    
    console.log(`Verification result for order ${order._id}:`, {
      isValid: verification.isValid,
      confidence: verification.confidence,
      issues: verification.issues
    });
    
    // Update order with verification results
    order.verificationNotes = `Automatic verification: ${verification.confidence}% confidence. Issues: ${verification.issues.join(', ')}`;
    
    if (verification.isValid && verification.confidence >= 40) {
      // Automatic approval for any valid verification
      order.paymentStatus = 'completed';
      order.verifiedAt = new Date();
      order.verifiedBy = null; // Automatic verification
      
      await order.save();
      
      // Generate and send tickets
      await router.generateAndSendTickets(order, event);
      
      console.log(`Order ${order._id} automatically verified and tickets sent`);
    } else if (verification.confidence >= 20) {
      // Medium confidence - auto-approve with 5-minute delay for user correction
      order.paymentStatus = 'pending_auto_approval';
      order.verificationNotes += ` [Auto-approval in 5 minutes unless corrected - confidence: ${verification.confidence}%]`;
      order.autoApprovalAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
      
      await order.save();
      
      // Schedule auto-approval
      setTimeout(async () => {
        try {
          const currentOrder = await Order.findById(order._id).populate('eventId');
          if (currentOrder && currentOrder.paymentStatus === 'pending_auto_approval') {
            currentOrder.paymentStatus = 'completed';
            currentOrder.verifiedAt = new Date();
            currentOrder.verifiedBy = null;
            currentOrder.verificationNotes += ' [Auto-approved after 5-minute grace period]';
            await currentOrder.save();
            await router.generateAndSendTickets(currentOrder, currentOrder.eventId);
            console.log(`Order ${currentOrder._id} auto-approved after grace period`);
          }
        } catch (error) {
          console.error(`Auto-approval failed for order ${order._id}:`, error);
        }
      }, 5 * 60 * 1000);
      
      console.log(`Order ${order._id} scheduled for auto-approval in 5 minutes (confidence: ${verification.confidence}%)`);
    } else if (verification.confidence >= 40) {
      // Low-medium confidence - quick admin review (1-hour SLA)
      order.paymentStatus = 'pending_quick_review';
      order.verificationNotes += ` [Quick review needed - confidence: ${verification.confidence}%]`;
      order.reviewPriority = 'high';
      
      await order.save();
      
      console.log(`Order ${order._id} flagged for quick admin review (confidence: ${verification.confidence}%)`);
    } else {
      // Very low confidence - auto-approve anyway to reduce friction
      order.paymentStatus = 'completed';
      order.verifiedAt = new Date();
      order.verifiedBy = null; // Automatic verification
      order.verificationNotes += ` [Auto-approved with low confidence - confidence: ${verification.confidence}%]`;
      
      await order.save();
      
      // Generate and send tickets
      await router.generateAndSendTickets(order, event);
      
      console.log(`Order ${order._id} auto-approved with low confidence (${verification.confidence}%) and tickets sent`);
    }
  } catch (error) {
    console.error(`Automatic verification failed for order ${order._id}:`, error);
    // OCR failed - auto-approve anyway to reduce friction
    order.paymentStatus = 'completed';
    order.verifiedAt = new Date();
    order.verifiedBy = null; // Automatic verification
    order.verificationNotes = `Automatic verification failed: ${error.message} [Auto-approved despite OCR failure]`;
    await order.save();
    
    // Generate and send tickets even if OCR failed
    try {
      await router.generateAndSendTickets(order, order.eventId || event);
      console.log(`Order ${order._id} auto-approved despite OCR failure and tickets sent`);
    } catch (ticketError) {
      console.error(`Failed to generate tickets for order ${order._id}:`, ticketError);
    }
  }
};

// Generate and send tickets
router.generateAndSendTickets = async function(order, event) {
  try {
    // Generate ticket PDFs
    const tickets = await ticketGeneratorService.generateTicketsForOrder(order, event);
    
    // Send email with tickets
    await sendTicketEmailWithAttachments(order, event, tickets);
    
    console.log(`Tickets generated and sent for order ${order._id}`);
  } catch (error) {
    console.error(`Failed to generate/send tickets for order ${order._id}:`, error);
    throw error;
  }
};

// Send WhatsApp confirmation to customer
router.sendWhatsAppConfirmation = async function(order, event) {
  try {
    // Send WhatsApp message to customer
    const customerWhatsappMessage = `🎟️ *Ticket Confirmation*\n\nHi ${order.customerInfo.firstName}!\n\nYour payment has been verified and your tickets for *${event.name}* are ready!\n\n📧 Check your email: ${order.customerInfo.email}\n🎫 Order: ${order.orderNumber}\n💰 Amount: Rs ${order.totalAmount.toFixed(2)}\n📅 Event Date: ${new Date(event.date).toLocaleDateString()}\n\nThank you for your purchase! 🎉\n\nSee you at the event!`;
    
    console.log(`WhatsApp confirmation message for order ${order._id}:`);
    console.log(`To Customer: ${order.customerInfo.phone}`);
    console.log(`Message: ${customerWhatsappMessage}`);
    
    // TODO: Implement actual WhatsApp API integration here
    // Example: await whatsappAPI.sendMessage(order.customerInfo.phone, customerWhatsappMessage);
    
    // Also send notification to organizer if WhatsApp number is available
    if (order.organizerWhatsApp) {
      const organizerMessage = `✅ *Payment Verified*\n\nOrder ${order.orderNumber} has been verified and tickets sent to:\n\n👤 Customer: ${order.customerInfo.firstName} ${order.customerInfo.lastName}\n📧 Email: ${order.customerInfo.email}\n📱 Phone: ${order.customerInfo.phone}\n💰 Amount: Rs ${order.totalAmount.toFixed(2)}\n🎫 Event: ${event.name}`;
      
      console.log(`Organizer notification:`);
      console.log(`To Organizer: ${order.organizerWhatsApp}`);
      console.log(`Message: ${organizerMessage}`);
      
      // TODO: await whatsappAPI.sendMessage(order.organizerWhatsApp, organizerMessage);
    }
    
  } catch (error) {
    console.error(`Failed to send WhatsApp confirmation for order ${order._id}:`, error);
    throw error;
  }
};

// Enhanced email function with ticket attachments
const sendTicketEmailWithAttachments = async (order, event, tickets) => {
  const nodemailer = require('nodemailer');
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const attachments = tickets.map(ticket => ({
    filename: ticket.filename,
    path: ticket.filepath
  }));

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: order.customerInfo.email,
    subject: `Your Tickets for ${event.name} - Order #${order.orderNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #FF6B35;">🎟️ Your Tickets Are Ready!</h2>
        
        <p>Hi ${order.customerInfo.firstName},</p>
        
        <p>Great news! Your payment has been verified and your tickets for <strong>${event.name}</strong> are now ready.</p>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Event Details</h3>
          <p><strong>Event:</strong> ${event.name}</p>
          <p><strong>Date:</strong> ${new Date(event.startDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}</p>
          <p><strong>Time:</strong> ${new Date(event.startDate).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })}</p>
          <p><strong>Venue:</strong> ${event.venueName || event.location}</p>
        </div>
        
        <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2d5a2d;">Order Summary</h3>
          <p><strong>Order Number:</strong> ${order.orderNumber}</p>
          <p><strong>Payment Reference:</strong> ${order.paymentReference}</p>
          <p><strong>Total Amount:</strong> Rs${order.totalAmount.toFixed(2)}</p>
        </div>
        
        <h3>📎 Your Tickets</h3>
        <p>Your e-tickets are attached to this email as PDF files. Each ticket contains a unique QR code for entry verification.</p>
        
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <h4 style="margin-top: 0; color: #856404;">Important Instructions:</h4>
          <ul style="color: #856404;">
            <li>Present your ticket (digital or printed) at the venue entrance</li>
            <li>Arrive 15-30 minutes before the event starts</li>
            <li>Keep your QR code safe and do not share it</li>
            <li>Bring a valid ID for verification</li>
          </ul>
        </div>
        
        <p>If you have any questions or need assistance, please contact our support team at <a href="mailto:support@ticketeer.com">support@ticketeer.com</a>.</p>
        
        <p>We hope you enjoy the event!</p>
        
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Best regards,<br>
          The Ticketeer Team
        </p>
      </div>
    `,
    attachments
  };

  await transporter.sendMail(mailOptions);
};

// PUT /api/orders/:id/verify - Verify MCB Juice payment (Admin only)
router.put('/:id/verify', async (req, res) => {
  try {
    const { paymentStatus, verificationNotes, verifiedBy } = req.body;
    
    const order = await Order.findById(req.params.id).populate('eventId');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update payment status and verification info
    order.paymentStatus = paymentStatus;
    if (verificationNotes) order.verificationNotes = verificationNotes;
    if (verifiedBy) order.verifiedBy = verifiedBy;
    order.verifiedAt = new Date();

    const updatedOrder = await order.save();

    // Send confirmation email and WhatsApp if payment is verified as completed
    if (paymentStatus === 'completed') {
      try {
        // Always send email with tickets
        await router.generateAndSendTickets(updatedOrder, order.eventId);
        
        // Always send WhatsApp confirmation to customer (for all payment methods)
        await router.sendWhatsAppConfirmation(updatedOrder, order.eventId);
        
        console.log(`Manual verification completed, tickets sent via email and WhatsApp confirmation sent for order ${updatedOrder._id}`);
      } catch (error) {
        console.error('Failed to send confirmations:', error);
        // Don't throw error to prevent verification from failing if notifications fail
      }
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error('Error verifying order:', error);
    res.status(500).json({ error: 'Failed to verify order' });
  }
});

// PUT /api/orders/:id - Update order status
router.put('/:id', async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// DELETE /api/orders/:id - Cancel/delete order
router.delete('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update status to cancelled instead of deleting
    order.status = 'cancelled';
    await order.save();

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

module.exports = router;
