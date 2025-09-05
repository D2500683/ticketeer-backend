const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { validateAndSanitize } = require('../middleware/sanitization');

const router = express.Router();


// Registration route
router.post(
  '/register',
  validateAndSanitize.user,
  [
    body('username').isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { username, email, password } = req.body;
    try {
      console.log('Registering user:', { username, email });
      let user = await User.findOne({ $or: [{ email }, { username }] });
      if (user) {
        console.log('User already exists:', user);
        return res.status(409).json({ error: 'Username or email already in use.' });
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      user = new User({ username, email, password: hashedPassword });
      const savedUser = await user.save();
      console.log('User saved:', savedUser);
      // Send confirmation email
      const { sendConfirmationEmail } = require('../utils/sendConfirmationEmail');
      try {
        await sendConfirmationEmail(savedUser);
        console.log('Confirmation email sent successfully');
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        return res.status(500).json({ error: 'Registration successful but failed to send confirmation email. Please contact support.' });
      }
      return res.status(201).json({ message: 'Registration successful! Please check your email to confirm your account.' });
    } catch (err) {
      console.error('Registration error:', err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// Login route
router.post(
  '/login',
  validateAndSanitize.user,
  [
    body('email').isEmail(),
    body('password').exists(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email }).select('+password emailConfirmed');
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      if (!user.emailConfirmed) {
        return res.status(403).json({ error: 'Please confirm your email before logging in.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const token = jwt.sign(
        { userId: user._id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '24h' } // Extended to 24 hours
      );
      return res.json({ 
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email
        }
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error.' });
    }
  }
);

// Email confirmation endpoint
router.get('/confirm/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).send('Invalid confirmation link.');
    }
    if (user.emailConfirmed) {
      return res.send('Email already confirmed. You can now log in.');
    }
    user.emailConfirmed = true;
    await user.save();
    return res.send('Email confirmed successfully! You can now log in.');
  } catch (err) {
    return res.status(400).send('Invalid or expired confirmation link.');
  }
});

// Token validation endpoint
router.get('/validate', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided', valid: false });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ error: 'User not found', valid: false });
    }

    res.json({ 
      valid: true, 
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', valid: false });
    }
    return res.status(401).json({ error: 'Invalid token', valid: false });
  }
});

module.exports = router;

