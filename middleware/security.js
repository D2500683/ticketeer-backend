const rateLimit = require('express-rate-limit');

/**
 * Additional security middleware configurations
 */

// Strict rate limiting for sensitive operations
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 requests per windowMs
  message: {
    error: 'Too many attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// File upload rate limiting
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 uploads per minute
  message: {
    error: 'Too many file uploads, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Order creation rate limiting
const orderLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 orders per 5 minutes
  message: {
    error: 'Too many order attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Request logging middleware for security monitoring
 */
const securityLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  // Log suspicious patterns
  const suspiciousPatterns = [
    /script/i,
    /javascript/i,
    /vbscript/i,
    /onload/i,
    /onerror/i,
    /<.*>/,
    /union.*select/i,
    /drop.*table/i,
    /insert.*into/i,
    /delete.*from/i
  ];
  
  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });
  
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(requestData) || pattern.test(req.url)
  );
  
  if (isSuspicious) {
    console.warn(`🚨 SUSPICIOUS REQUEST DETECTED:`, {
      timestamp,
      ip,
      method: req.method,
      url: req.url,
      userAgent,
      body: req.body,
      query: req.query
    });
  }
  
  // Log all authentication attempts
  if (req.path.includes('/auth/')) {
    console.log(`🔐 AUTH REQUEST:`, {
      timestamp,
      ip,
      method: req.method,
      path: req.path,
      userAgent
    });
  }
  
  next();
};

/**
 * Content Security Policy headers
 */
const setSecurityHeaders = (req, res, next) => {
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * Validate request size and structure
 */
const validateRequest = (req, res, next) => {
  // Check for excessively large requests
  const contentLength = req.get('Content-Length');
  if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) { // 50MB limit
    return res.status(413).json({ error: 'Request too large' });
  }
  
  // Validate JSON structure depth to prevent DoS
  if (req.body && typeof req.body === 'object') {
    const maxDepth = 10;
    
    function getDepth(obj, depth = 0) {
      if (depth > maxDepth) return depth;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Math.max(...Object.values(obj).map(v => getDepth(v, depth + 1)));
      }
      return depth;
    }
    
    if (getDepth(req.body) > maxDepth) {
      return res.status(400).json({ error: 'Request structure too complex' });
    }
  }
  
  next();
};

module.exports = {
  strictLimiter,
  uploadLimiter,
  orderLimiter,
  securityLogger,
  setSecurityHeaders,
  validateRequest
};
