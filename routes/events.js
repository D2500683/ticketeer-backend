const express = require('express');
const { body, validationResult } = require('express-validator');
const Event = require('../models/Event');
const LivePlaylist = require('../models/LivePlaylist');
const authenticateToken = require('../middleware/authenticateToken');
const { validateAndSanitize } = require('../middleware/sanitization');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Get all events (public - for explore page)
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/events - Request received with query:', req.query);
    
    const { page = 1, limit = 10, search, status } = req.query;
    
    const query = {};
    
    // Only filter by status if explicitly provided
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('MongoDB query:', query);
    console.log('Pagination - page:', page, 'limit:', limit);

    const events = await Event.find(query)
      .populate('organizer', 'username')
      .sort({ startDate: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-eventPassword');

    console.log('Events found:', events.length);

    const total = await Event.countDocuments(query);
    console.log('Total events count:', total);

    const response = {
      events,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    };

    console.log('Sending response with', events.length, 'events');
    res.json(response);
  } catch (error) {
    console.error('Error in GET /api/events:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Server error while fetching events',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get single event by ID
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'username email')
      .select('-eventPassword');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get attendees from orders instead of event.attendees
    const Order = require('../models/Order');
    const orders = await Order.find({ 
      eventId: req.params.id,
      paymentStatus: 'completed'
    }).sort({ createdAt: -1 });

    // Process attendees from orders
    const attendeesFromOrders = orders.map(order => ({
      id: order._id,
      customerInfo: {
        firstName: order.customerInfo.firstName,
        lastName: order.customerInfo.lastName,
        email: order.customerInfo.email
      },
      tickets: order.tickets,
      purchaseDate: order.createdAt,
      totalAmount: order.totalAmount,
      // For compatibility with existing frontend code
      ticketType: order.tickets.length > 0 ? order.tickets[0].name : 'General',
      quantity: order.tickets.reduce((sum, ticket) => sum + ticket.quantity, 0)
    }));

    // Calculate total tickets sold from orders
    const totalTicketsSoldFromOrders = orders.reduce((sum, order) => {
      return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
    }, 0);

    // Return event with order-based attendee data
    const eventWithOrderData = {
      ...event.toObject(),
      attendees: attendeesFromOrders,
      totalTicketsSold: totalTicketsSoldFromOrders
    };

    res.json(eventWithOrderData);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Server error while fetching event' });
  }
});

// Get user's events (protected)
router.get('/user/my-events', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { organizer: req.user.userId };
    if (status) {
      query.status = status;
    }

    const events = await Event.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Event.countDocuments(query);

    // Calculate totals for each event
    events.forEach(event => event.calculateTotals());

    // Get orders for actual revenue and ticket calculations
    const Order = require('../models/Order');
    const orders = await Order.find({
      eventId: { $in: events.map(e => e._id) },
      paymentStatus: 'completed'
    });

    // Add actual revenue and tickets sold to each event
    const eventsWithOrderData = events.map(event => {
      const eventOrders = orders.filter(o => o.eventId.toString() === event._id.toString());
      const eventTicketsSold = eventOrders.reduce((sum, order) => {
        return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
      }, 0);
      const eventRevenue = eventOrders.reduce((sum, order) => sum + order.totalAmount, 0);
      
      return {
        ...event.toObject(),
        actualTicketsSold: eventTicketsSold,
        actualRevenue: eventRevenue
      };
    });

    res.json({
      events: eventsWithOrderData,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error while fetching user events' });
  }
});

// Create new event (protected)
router.post(
  '/',
  authenticateToken,
  validateAndSanitize.event,
  [
    body('name').notEmpty().trim().isLength({ max: 200 }),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('location').notEmpty().trim(),
    body('ticketTypes').isArray({ min: 1 }),
    body('ticketTypes.*.name').notEmpty().trim(),
    body('ticketTypes.*.price').isNumeric({ min: 0 }),
    body('ticketTypes.*.quantity').isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const eventData = {
        ...req.body,
        organizer: req.user.userId,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate)
      };

      // Validate end date is after start date
      if (eventData.endDate <= eventData.startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }

      const event = new Event(eventData);
      await event.save();

      // Auto-create live playlist if enabled
      if (eventData.enableLivePlaylist) {
        const livePlaylist = new LivePlaylist({
          eventId: event._id,
          djId: req.user.userId,
          settings: eventData.livePlaylistSettings || {
            allowRequests: true,
            requireApproval: true,
            maxRequestsPerUser: 3,
            votingEnabled: true,
            autoPlayNext: false
          }
        });
        await livePlaylist.save();
      }

      const populatedEvent = await Event.findById(event._id)
        .populate('organizer', 'username');

      res.status(201).json(populatedEvent);
    } catch (error) {
      console.error('Event creation error:', error);
      res.status(500).json({ error: 'Server error while creating event' });
    }
  }
);

// Update event (protected)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if user is the organizer
    if (event.organizer.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized to update this event' });
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate('organizer', 'username');

    res.json(updatedEvent);
  } catch (error) {
    res.status(500).json({ error: 'Server error while updating event' });
  }
});

// Delete event (protected)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if user is the organizer
    if (event.organizer.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error while deleting event' });
  }
});

// Purchase ticket (protected)
router.post('/:id/purchase', authenticateToken, async (req, res) => {
  try {
    const { ticketType, quantity = 1 } = req.body;
    
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const ticket = event.ticketTypes.find(t => t.name === ticketType);
    if (!ticket) {
      return res.status(400).json({ error: 'Invalid ticket type' });
    }

    if (ticket.sold + quantity > ticket.quantity) {
      return res.status(400).json({ error: 'Not enough tickets available' });
    }

    // Add attendee
    event.attendees.push({
      user: req.user.userId,
      ticketType,
      quantity
    });

    // Update sold count
    ticket.sold += quantity;

    // Recalculate totals
    event.calculateTotals();

    await event.save();

    res.json({ message: 'Ticket purchased successfully', event });
  } catch (error) {
    res.status(500).json({ error: 'Server error while purchasing ticket' });
  }
});

// Get dashboard analytics (protected)
router.get('/user/analytics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const Order = require('../models/Order');
    
    // Get user's events
    const events = await Event.find({ organizer: userId });
    const eventIds = events.map(e => e._id);
    
    // Get all orders for user's events
    const orders = await Order.find({ 
      eventId: { $in: eventIds },
      paymentStatus: 'completed'
    });
    
    // Calculate analytics from orders
    const totalEvents = events.length;
    const activeEvents = events.filter(e => e.status === 'published' && e.endDate > new Date()).length;
    
    // Calculate revenue and tickets from orders
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const totalTicketsSold = orders.reduce((sum, order) => {
      return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
    }, 0);

    // Recent activity (last 30 days) from orders
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentOrders = orders.filter(o => o.createdAt >= thirtyDaysAgo);
    const recentTicketsSold = recentOrders.reduce((sum, order) => {
      return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
    }, 0);

    // Sales data for charts (last 7 days) from orders
    const salesData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));
      
      const dayOrders = orders.filter(o => 
        o.createdAt >= dayStart && o.createdAt <= dayEnd
      );
      
      const dayTickets = dayOrders.reduce((sum, order) => {
        return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
      }, 0);
      
      const dayRevenue = dayOrders.reduce((sum, order) => sum + order.totalAmount, 0);

      salesData.push({
        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        sales: dayTickets,
        revenue: dayRevenue
      });
    }

    // Calculate updated event stats with order data
    const eventsWithOrderData = events.map(event => {
      const eventOrders = orders.filter(o => o.eventId.toString() === event._id.toString());
      const eventTicketsSold = eventOrders.reduce((sum, order) => {
        return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
      }, 0);
      const eventRevenue = eventOrders.reduce((sum, order) => sum + order.totalAmount, 0);
      
      return {
        ...event.toObject(),
        actualTicketsSold: eventTicketsSold,
        actualRevenue: eventRevenue
      };
    });

    // Generate recent activity from orders
    const recentActivity = orders
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map(order => {
        const event = events.find(e => e._id.toString() === order.eventId.toString());
        const totalTickets = order.tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
        const ticketDetails = order.tickets.map(t => `${t.quantity}x ${t.name}`).join(', ');
        
        return {
          id: order._id,
          type: 'sale',
          message: `${order.customerInfo.firstName} ${order.customerInfo.lastName} purchased ${ticketDetails} for ${event?.name || 'Unknown Event'}`,
          time: new Date(order.createdAt).toLocaleString(),
          amount: order.totalAmount
        };
      });

    res.json({
      totalEvents,
      activeEvents,
      totalRevenue,
      totalTicketsSold,
      recentTicketsSold,
      salesData,
      recentActivity,
      upcomingEvents: eventsWithOrderData
        .filter(e => e.startDate > new Date())
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .slice(0, 5)
        .map(e => ({
          id: e._id,
          name: e.name,
          date: e.startDate,
          sold: e.actualTicketsSold || 0,
          total: e.ticketTypes.reduce((sum, t) => sum + t.quantity, 0),
          revenue: e.actualRevenue || 0
        }))
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Server error while fetching analytics' });
  }
});

// Get attendees from orders (protected)
router.get('/user/attendees', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const Order = require('../models/Order');
    
    // Get user's events
    const events = await Event.find({ organizer: userId });
    const eventIds = events.map(e => e._id);
    
    // Get all completed orders for user's events
    const orders = await Order.find({ 
      eventId: { $in: eventIds },
      paymentStatus: 'completed'
    }).sort({ createdAt: -1 });
    
    // Process attendees from orders
    const attendeeMap = new Map();
    
    orders.forEach(order => {
      const event = events.find(e => e._id.toString() === order.eventId.toString());
      if (!event) return;
      
      // Use customer email as unique identifier for attendees
      const attendeeKey = order.customerInfo.email.toLowerCase();
      
      if (attendeeMap.has(attendeeKey)) {
        const existing = attendeeMap.get(attendeeKey);
        existing.registeredEvents += 1;
        existing.totalSpent += order.totalAmount;
        existing.lastEvent = event.name;
        existing.lastOrderDate = order.createdAt;
      } else {
        attendeeMap.set(attendeeKey, {
          id: order._id,
          name: `${order.customerInfo.firstName} ${order.customerInfo.lastName}`,
          email: order.customerInfo.email,
          phone: order.customerInfo.phone || 'N/A',
          location: 'N/A', // Orders don't store location currently
          avatar: '/placeholder.svg',
          registeredEvents: 1,
          totalSpent: order.totalAmount,
          lastEvent: event.name,
          registrationDate: order.createdAt,
          lastOrderDate: order.createdAt,
          status: order.totalAmount > 350 ? 'VIP' : order.totalAmount > 0 ? 'Regular' : 'New'
        });
      }
    });
    
    const attendees = Array.from(attendeeMap.values());
    
    res.json({ attendees });
  } catch (error) {
    console.error('Attendees error:', error);
    res.status(500).json({ error: 'Server error while fetching attendees' });
  }
});

module.exports = router;
