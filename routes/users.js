const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Event = require('../models/Event');
const authenticateToken = require('../middleware/authenticateToken');

const router = express.Router();

// Get user profile (protected)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error while fetching profile' });
  }
});

// Update user profile (protected)
router.put('/profile', authenticateToken, [
  body('username').optional().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
  body('email').optional().isEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { username, email } = req.body;
    const userId = req.user.userId;

    // Check if username or email already exists (excluding current user)
    if (username || email) {
      const existingUser = await User.findOne({
        $and: [
          { _id: { $ne: userId } },
          { $or: [
            username ? { username } : {},
            email ? { email } : {}
          ]}
        ]
      });

      if (existingUser) {
        return res.status(409).json({ error: 'Username or email already in use' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { ...req.body },
      { new: true, runValidators: true }
    ).select('-password');

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: 'Server error while updating profile' });
  }
});

// Change password (protected)
router.put('/change-password', authenticateToken, [
  body('currentPassword').exists(),
  body('newPassword').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(userId, { password: hashedNewPassword });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error while changing password' });
  }
});

// Get user's events summary (protected)
router.get('/events-summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const events = await Event.find({ organizer: userId });
    
    const summary = {
      totalEvents: events.length,
      publishedEvents: events.filter(e => e.status === 'published').length,
      draftEvents: events.filter(e => e.status === 'draft').length,
      completedEvents: events.filter(e => e.status === 'completed').length,
      upcomingEvents: events.filter(e => e.startDate > new Date() && e.status === 'published').length,
      totalRevenue: 0,
      totalTicketsSold: 0
    };

    // Calculate totals
    events.forEach(event => {
      event.calculateTotals();
      summary.totalRevenue += event.totalRevenue;
      summary.totalTicketsSold += event.totalTicketsSold;
    });

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Server error while fetching events summary' });
  }
});

// Get user's purchased tickets (protected)
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const events = await Event.find({
      'attendees.user': userId
    }).populate('organizer', 'username');

    const tickets = [];
    events.forEach(event => {
      const userAttendances = event.attendees.filter(
        attendee => attendee.user.toString() === userId
      );
      
      userAttendances.forEach(attendance => {
        const ticketType = event.ticketTypes.find(t => t.name === attendance.ticketType);
        tickets.push({
          eventId: event._id,
          eventName: event.name,
          eventDate: event.startDate,
          location: event.location,
          organizer: event.organizer.username,
          ticketType: attendance.ticketType,
          quantity: attendance.quantity,
          price: ticketType ? ticketType.price : 0,
          purchaseDate: attendance.purchaseDate,
          status: event.status
        });
      });
    });

    // Sort by purchase date (newest first)
    tickets.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: 'Server error while fetching tickets' });
  }
});

// Delete user account (protected)
router.delete('/account', authenticateToken, [
  body('password').exists(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { password } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Password is incorrect' });
    }

    // Check if user has active events
    const activeEvents = await Event.find({
      organizer: userId,
      status: 'published',
      endDate: { $gt: new Date() }
    });

    if (activeEvents.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete account with active events. Please cancel or complete your events first.' 
      });
    }

    // Delete user's events
    await Event.deleteMany({ organizer: userId });

    // Remove user from attendees lists
    await Event.updateMany(
      { 'attendees.user': userId },
      { $pull: { attendees: { user: userId } } }
    );

    // Delete user account
    await User.findByIdAndDelete(userId);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error while deleting account' });
  }
});

module.exports = router;
