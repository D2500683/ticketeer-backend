const express = require('express');
const Order = require('../models/Order');
const Event = require('../models/Event');
const authenticateToken = require('../middleware/authenticateToken');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Middleware to check admin role (you'll need to implement user roles)
const requireAdmin = (req, res, next) => {
  // For now, we'll skip role checking - implement based on your auth system
  // if (!req.user || req.user.role !== 'admin') {
  //   return res.status(403).json({ error: 'Admin access required' });
  // }
  next();
};

// GET /api/admin/orders/pending - Get orders pending verification
router.get('/orders/pending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get organizer's events first
    const organizerEvents = await Event.find({ organizer: userId }).select('_id');
    const eventIds = organizerEvents.map(event => event._id);
    
    // Filter pending orders by organizer's events only
    const pendingOrders = await Order.find({
      paymentStatus: { $in: ['pending_verification', 'pending_whatsapp_verification', 'pending_auto_approval', 'pending_quick_review'] },
      eventId: { $in: eventIds }
    })
    .populate('eventId')
    .sort({ createdAt: -1 });

    res.json(pendingOrders);
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

// GET /api/admin/orders/:id/screenshot - Serve screenshot for verification
router.get('/orders/:id/screenshot', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || !order.transferScreenshot) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    const screenshotPath = order.transferScreenshot;
    if (!fs.existsSync(screenshotPath)) {
      return res.status(404).json({ error: 'Screenshot file not found' });
    }

    res.sendFile(path.resolve(screenshotPath));
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

// GET /api/admin/orders/stats - Get verification statistics
router.get('/orders/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get organizer's events
    const organizerEvents = await Event.find({ organizer: userId }).select('_id');
    const eventIds = organizerEvents.map(event => event._id);
    
    const stats = await Order.aggregate([
      {
        $match: {
          eventId: { $in: eventIds }
        }
      },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    const formattedStats = {
      pending_verification: { count: 0, totalAmount: 0 },
      pending_whatsapp_verification: { count: 0, totalAmount: 0 },
      pending_auto_approval: { count: 0, totalAmount: 0 },
      pending_quick_review: { count: 0, totalAmount: 0 },
      completed: { count: 0, totalAmount: 0 },
      failed: { count: 0, totalAmount: 0 }
    };

    stats.forEach(stat => {
      if (formattedStats[stat._id]) {
        formattedStats[stat._id] = {
          count: stat.count,
          totalAmount: stat.totalAmount
        };
      }
    });

    // Get recent activity for organizer's events only
    const recentOrders = await Order.find({
      eventId: { $in: eventIds }
    })
    .populate('eventId', 'name')
    .sort({ createdAt: -1 })
    .limit(10);

    res.json({
      stats: formattedStats,
      recentOrders
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// POST /api/admin/orders/:id/verify - Manual verification
router.post('/orders/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { action, notes } = req.body; // action: 'approve' or 'reject'
    
    const order = await Order.findById(req.params.id).populate('eventId');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!['pending_verification', 'pending_whatsapp_verification', 'pending_auto_approval', 'pending_quick_review'].includes(order.paymentStatus)) {
      return res.status(400).json({ error: 'Order is not pending verification' });
    }

    // Update order based on action
    if (action === 'approve') {
      // Store original status to rollback if needed
      const originalStatus = order.paymentStatus;
      
      // Generate and send tickets FIRST - before updating order status
      const router_orders = require('./orders');
      console.log('Starting ticket generation for order:', order._id);
      console.log('Event details:', order.eventId);
      
      try {
        await router_orders.generateAndSendTickets(order, order.eventId);
        console.log('Tickets generated successfully');
      } catch (ticketError) {
        console.error('Ticket generation failed:', ticketError);
        throw new Error(`Failed to generate tickets: ${ticketError.message}`);
      }
      
      // Send WhatsApp confirmation to customer
      try {
        await router_orders.sendWhatsAppConfirmation(order, order.eventId);
        console.log('WhatsApp confirmation sent successfully');
      } catch (whatsappError) {
        console.error('WhatsApp confirmation failed:', whatsappError);
        throw new Error(`Failed to send WhatsApp confirmation: ${whatsappError.message}`);
      }

      // Only update order status AFTER tickets are successfully sent
      order.paymentStatus = 'completed';
      order.verifiedBy = req.user?.userId || 'admin';
      order.verifiedAt = new Date();
      order.verificationNotes = notes || 'Manually approved by admin';

      await order.save();

      res.json({
        success: true,
        message: 'Order approved and tickets sent',
        order
      });
    } else if (action === 'reject') {
      order.paymentStatus = 'failed';
      order.verifiedBy = req.user?.userId || 'admin';
      order.verifiedAt = new Date();
      order.verificationNotes = notes || 'Rejected by admin';

      await order.save();

      // Restore ticket quantities when rejecting order
      for (const ticket of order.tickets) {
        await Event.findOneAndUpdate(
          { _id: order.event._id, 'ticketTypes._id': ticket.ticketTypeId },
          { $inc: { 'ticketTypes.$.quantity': ticket.quantity } }
        );
      }

      res.json({
        success: true,
        message: 'Order rejected',
        order
      });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
    }
  } catch (error) {
    console.error('Error processing verification:', error);
    res.status(500).json({ error: 'Failed to process verification' });
  }
});

module.exports = router;
