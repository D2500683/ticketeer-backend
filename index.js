const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : 
      [
        'https://ticketeer-frontend-qt4y.vercel.app',
        'https://ticketeer-frontend.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000'
      ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;

// Security Middleware
// Set security HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", process.env.BACKEND_URL || "http://localhost:3001", "https://api.cloudinary.com"],
      mediaSrc: ["'self'", "https:", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false // Allow embedding for development
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS configuration - must come before other middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
  process.env.ALLOWED_ORIGINS.split(',') : 
  [
    'https://ticketeer-frontend-qt4y.vercel.app',
    'https://ticketeer-frontend.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    // Add wildcard for Vercel preview deployments
    'https://ticketeer-frontend-git-main-d2500683s-projects.vercel.app'
  ];

console.log('Allowed CORS origins:', allowedOrigins);

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  console.log('Preflight request from origin:', origin);
  
  if (!origin || allowedOrigins.indexOf(origin) !== -1) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    res.sendStatus(200);
  } else {
    console.log('Preflight blocked for origin:', origin);
    res.sendStatus(403);
  }
});

// Apply rate limiting
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Data sanitization against NoSQL query injection - handled by our custom sanitization middleware

// Prevent parameter pollution
app.use(hpp({
  whitelist: ['sort', 'fields', 'page', 'limit'] // Allow these parameters to be duplicated
}));

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization middleware
const { sanitizeInput } = require('./middleware/sanitization');
const { securityLogger, setSecurityHeaders, validateRequest, orderLimiter, uploadLimiter } = require('./middleware/security');

// Apply security middleware
app.use(securityLogger);
app.use(setSecurityHeaders);
app.use(validateRequest);
app.use(sanitizeInput);

// Make io available to routes
app.set('io', io);

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ticketeer';
mongoose.connect(MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Auth routes
const eventsRouter = require('./routes/events');
const ordersRouter = require('./routes/orders');
const authRouter = require('./routes/auth');
const colorsRouter = require('./routes/colors');
const livePlaylistRouter = require('./routes/livePlaylist');
const spotifyRouter = require('./routes/spotify');
const youtubeRouter = require('./routes/youtube');
const usersRouter = require('./routes/users');
const uploadsRouter = require('./routes/upload');
const mcbJuiceManualRouter = require('./routes/mcbJuiceManual');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/colors', require('./routes/colors'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/spotify', require('./routes/spotify'));
app.use('/api/playlists', require('./routes/livePlaylist'));
app.use('/api/users', require('./routes/users'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/mcbJuiceManual', require('./routes/mcbJuiceManual'));
app.use('/api/admin', require('./routes/admin'));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Sample route
app.get('/', (req, res) => {
  res.json({ message: 'Ticketeer backend is running!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined in .env');
  process.exit(1);
}

// Initialize Socket.IO for live playlist functionality
const LivePlaylistSocket = require('./socket/livePlaylistSocket');
new LivePlaylistSocket(io);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Socket.IO server initialized for live playlist functionality');
});
