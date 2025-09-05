const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Event = require('../models/Event');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
// Email service not implemented yet
// const { sendOrderConfirmationEmail } = require('../services/emailService');

// Create manual MCB Juice payment order
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const {
      eventId,
      tickets,
      customerInfo,
      paymentReference
    } = req.body;

    // Validate required fields
    if (!eventId || !tickets || !customerInfo || !paymentReference) {
      return res.status(400).json({
        error: 'Missing required fields: eventId, tickets, customerInfo, paymentReference'
      });
    }

    // Get event details
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Calculate total amount
    let totalAmount = 0;
    const orderTickets = [];

    for (const ticket of tickets) {
      const eventTicket = event.ticketTypes.find(t => t._id.toString() === ticket.ticketTypeId);
      if (!eventTicket) {
        return res.status(400).json({ error: `Ticket type ${ticket.ticketTypeId} not found` });
      }

      // Check availability
      if (eventTicket.quantity < ticket.quantity) {
        return res.status(400).json({ 
          error: `Not enough tickets available for ${eventTicket.name}. Available: ${eventTicket.quantity}, Requested: ${ticket.quantity}` 
        });
      }

      const ticketTotal = eventTicket.price * ticket.quantity;
      totalAmount += ticketTotal;

      orderTickets.push({
        ticketTypeId: ticket.ticketTypeId,
        name: eventTicket.name,
        price: eventTicket.price,
        quantity: ticket.quantity,
        subtotal: ticketTotal
      });
    }

    // Create order
    const order = new Order({
      user: req.user.userId,
      event: eventId,
      tickets: orderTickets,
      totalAmount,
      paymentMethod: 'mcb-juice-manual',
      paymentStatus: 'pending_verification',
      paymentReference,
      customerInfo: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        email: customerInfo.email,
        phone: customerInfo.phone,
        address: customerInfo.address
      },
      attendees: tickets.map(ticket => ({
        ticketType: ticket.ticketTypeId,
        quantity: ticket.quantity,
        customerInfo: {
          firstName: customerInfo.firstName,
          lastName: customerInfo.lastName,
          email: customerInfo.email
        },
        user: req.user.userId
      }))
    });

    await order.save();

    // Update ticket quantities
    for (const ticket of tickets) {
      await Event.findOneAndUpdate(
        { _id: eventId, 'ticketTypes._id': ticket.ticketTypeId },
        { $inc: { 'ticketTypes.$.quantity': -ticket.quantity } }
      );
    }

    // Send confirmation email (not implemented yet)
    // try {
    //   await sendOrderConfirmationEmail(order, event);
    // } catch (emailError) {
    //   console.error('Failed to send confirmation email:', emailError);
    //   // Don't fail the order creation if email fails
    // }

    res.status(201).json({
      success: true,
      orderId: order._id,
      message: 'Order created successfully. Payment verification pending.',
      order: {
        id: order._id,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        paymentReference: order.paymentReference,
        tickets: order.tickets
      }
    });

  } catch (error) {
    console.error('Error creating MCB Juice manual order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get order details
router.get('/order/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate('event', 'title date location')
      .populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user owns this order or is admin
    if (order.user._id.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Admin: Get orders pending verification
router.get('/admin/pending-orders', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const orders = await Order.find({ 
      paymentMethod: 'mcb-juice-manual',
      paymentStatus: 'pending_verification' 
    })
    .populate('event', 'title date location')
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      orders
    });

  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

// Admin: Verify payment
router.post('/admin/verify-payment/:orderId', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { orderId } = req.params;
    const { verificationNotes } = req.body;

    const order = await Order.findById(orderId).populate('event');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.paymentStatus !== 'pending_verification') {
      return res.status(400).json({ error: 'Order is not pending verification' });
    }

    // Update order status
    order.paymentStatus = 'completed';
    order.verificationNotes = verificationNotes;
    order.verifiedBy = req.user.userId;
    order.verifiedAt = new Date();

    await order.save();

    // Send receipt email (not implemented yet)
    // try {
    //   await sendOrderConfirmationEmail(order, order.event, true); // true for receipt
    // } catch (emailError) {
    //   console.error('Failed to send receipt email:', emailError);
    // }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      order
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Admin: Reject payment
router.post('/admin/reject-payment/:orderId', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { orderId } = req.params;
    const { rejectionReason } = req.body;

    const order = await Order.findById(orderId).populate('event');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.paymentStatus !== 'pending_verification') {
      return res.status(400).json({ error: 'Order is not pending verification' });
    }

    // Update order status
    order.paymentStatus = 'failed';
    order.verificationNotes = rejectionReason;
    order.verifiedBy = req.user.userId;
    order.verifiedAt = new Date();

    await order.save();

    // Restore ticket quantities
    for (const ticket of order.tickets) {
      await Event.findOneAndUpdate(
        { _id: order.event._id, 'ticketTypes._id': ticket.ticketTypeId },
        { $inc: { 'ticketTypes.$.quantity': ticket.quantity } }
      );
    }

    res.json({
      success: true,
      message: 'Payment rejected successfully',
      order
    });

  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

module.exports = router;
