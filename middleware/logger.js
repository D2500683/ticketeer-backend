const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Production logging middleware
const logger = (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_REQUEST_LOGGING === 'true') {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${req.method} ${req.url} - IP: ${req.ip} - User-Agent: ${req.get('User-Agent')}\n`;
    
    // Log to file in production
    fs.appendFile(path.join(logsDir, 'access.log'), logEntry, (err) => {
      if (err) console.error('Logging error:', err);
    });
  }
  
  next();
};

// Error logging
const errorLogger = (error, req, res, next) => {
  const timestamp = new Date().toISOString();
  const errorEntry = `${timestamp} - ERROR: ${error.message} - Stack: ${error.stack} - URL: ${req.url}\n`;
  
  if (process.env.NODE_ENV === 'production') {
    fs.appendFile(path.join(logsDir, 'error.log'), errorEntry, (err) => {
      if (err) console.error('Error logging failed:', err);
    });
  } else {
    console.error(errorEntry);
  }
  
  next(error);
};

module.exports = { logger, errorLogger };
