const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  customerInfo: {
    firstName: {
      type: String,
      required: true
    },
    lastName: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: {
      type: String
    },
    address: {
      type: String
    },
    city: {
      type: String
    },
    zipCode: {
      type: String
    }
  },
  tickets: [{
    ticketTypeId: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['card', 'mcb-juice', 'mcb-juice-manual', 'mcb-juice-whatsapp', 'bank_transfer', 'bank-transfer-whatsapp']
  },
  paymentStatus: {
    type: String,
    required: true,
    enum: ['pending', 'pending_verification', 'pending_auto_approval', 'pending_quick_review', 'pending_whatsapp_verification', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String // For Stripe integration
  },
  paymentReference: {
    type: String // For manual payment reference codes
  },
  transferScreenshot: {
    type: String // URL/path to uploaded transfer screenshot
  },
  screenshotOriginalName: {
    type: String // Original filename of uploaded screenshot
  },
  verificationNotes: {
    type: String // Admin notes for payment verification
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Admin who verified the payment
  },
  verifiedAt: {
    type: Date // When payment was verified
  },
  autoApprovalAt: {
    type: Date // When auto-approval is scheduled
  },
  reviewPriority: {
    type: String,
    enum: ['high', 'standard'],
    default: 'standard'
  },
  organizerWhatsApp: {
    type: String // WhatsApp number for organizer notifications
  },
  attendees: [{
    ticketType: String,
    quantity: Number,
    customerInfo: {
      firstName: String,
      lastName: String,
      email: String
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isGuest: {
      type: Boolean,
      default: false
    }
  }],
  status: {
    type: String,
    enum: ['confirmed', 'cancelled', 'refunded'],
    default: 'confirmed'
  },
  orderNumber: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});

// Generate order number before saving
orderSchema.pre('save', function(next) {
  if (!this.orderNumber) {
    this.orderNumber = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
