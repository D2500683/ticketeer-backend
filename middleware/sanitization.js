const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Create a DOMPurify instance
const window = new JSDOM('').window;
const purify = DOMPurify(window);

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param {string} dirty - The potentially unsafe HTML string
 * @returns {string} - The sanitized HTML string
 */
const sanitizeHtml = (dirty) => {
  if (typeof dirty !== 'string') return dirty;
  
  return purify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
};

/**
 * Remove NoSQL injection patterns
 * @param {any} payload - The data to sanitize
 * @returns {any} - The sanitized data
 */
const sanitizeNoSQL = (payload) => {
  if (payload === null || payload === undefined) return payload;
  
  if (typeof payload === 'string') {
    // Remove common NoSQL injection patterns
    return payload.replace(/\$where|\$ne|\$in|\$nin|\$and|\$or|\$nor|\$not|\$exists|\$type|\$mod|\$regex|\$text|\$search/gi, '');
  }
  
  if (Array.isArray(payload)) {
    return payload.map(sanitizeNoSQL);
  }
  
  if (typeof payload === 'object') {
    const sanitized = {};
    for (const key in payload) {
      if (payload.hasOwnProperty(key)) {
        // Skip keys that start with $ (MongoDB operators)
        if (!key.startsWith('$')) {
          sanitized[key] = sanitizeNoSQL(payload[key]);
        }
      }
    }
    return sanitized;
  }
  
  return payload;
};

/**
 * Recursively sanitize object properties
 * @param {any} obj - The object to sanitize
 * @returns {any} - The sanitized object
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeHtml(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }
  
  return obj;
};

/**
 * Express middleware to sanitize request body, query, and params
 */
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeNoSQL(sanitizeObject(req.body));
    }
    
    // Create a new query object instead of modifying the existing one
    if (req.query && typeof req.query === 'object') {
      const sanitizedQuery = sanitizeNoSQL(sanitizeObject(req.query));
      // Only update if sanitization actually changed something
      if (JSON.stringify(sanitizedQuery) !== JSON.stringify(req.query)) {
        Object.assign(req.query, sanitizedQuery);
      }
    }
    
    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      const sanitizedParams = sanitizeNoSQL(sanitizeObject(req.params));
      if (JSON.stringify(sanitizedParams) !== JSON.stringify(req.params)) {
        Object.assign(req.params, sanitizedParams);
      }
    }
    
    next();
  } catch (error) {
    console.error('Input sanitization error:', error);
    console.error('Request details:', {
      url: req.url,
      method: req.method,
      query: req.query,
      body: req.body,
      params: req.params
    });
    next(); // Continue without sanitization rather than blocking the request
  }
};

/**
 * Validate and sanitize specific fields for different endpoints
 */
const validateAndSanitize = {
  // Event creation/update validation
  event: (req, res, next) => {
    const { body } = req;
    
    if (body.name) {
      body.name = sanitizeHtml(body.name).substring(0, 200);
    }
    
    if (body.description) {
      body.description = sanitizeHtml(body.description).substring(0, 5000);
    }
    
    if (body.location) {
      body.location = sanitizeHtml(body.location).substring(0, 500);
    }
    
    // Sanitize ticket type names and descriptions
    if (body.ticketTypes && Array.isArray(body.ticketTypes)) {
      body.ticketTypes = body.ticketTypes.map(ticket => ({
        ...ticket,
        name: sanitizeHtml(ticket.name || '').substring(0, 100),
        description: sanitizeHtml(ticket.description || '').substring(0, 500)
      }));
    }
    
    next();
  },
  
  // User registration/update validation
  user: (req, res, next) => {
    const { body } = req;
    
    if (body.username) {
      // Username should only contain alphanumeric and underscore
      body.username = body.username.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 32);
    }
    
    if (body.email) {
      body.email = body.email.toLowerCase().trim();
    }
    
    next();
  },
  
  // Order validation
  order: (req, res, next) => {
    const { body } = req;
    
    if (body.customerInfo) {
      const { customerInfo } = body;
      
      if (customerInfo.firstName) {
        customerInfo.firstName = sanitizeHtml(customerInfo.firstName).substring(0, 50);
      }
      
      if (customerInfo.lastName) {
        customerInfo.lastName = sanitizeHtml(customerInfo.lastName).substring(0, 50);
      }
      
      if (customerInfo.email) {
        customerInfo.email = customerInfo.email.toLowerCase().trim();
      }
      
      if (customerInfo.phone) {
        // Remove all non-numeric characters except + and -
        customerInfo.phone = customerInfo.phone.replace(/[^0-9+\-\s]/g, '').substring(0, 20);
      }
    }
    
    next();
  }
};

module.exports = {
  sanitizeInput,
  sanitizeHtml,
  sanitizeObject,
  sanitizeNoSQL,
  validateAndSanitize
};
