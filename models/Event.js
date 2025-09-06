const mongoose = require('mongoose');

const ticketTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  sold: {
    type: Number,
    default: 0,
    min: 0,
  },
  description: {
    type: String,
    trim: true,
  },
});

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  shortSummary: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  description: {
    type: String,
    trim: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  venueName: {
    type: String,
    trim: true,
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  ticketTypes: [ticketTypeSchema],
  images: [{
    url: String,
    alt: String,
  }],
  flyerUrl: {
    type: String,
  },
  youtubeUrl: {
    type: String,
  },
  spotifyUrl: {
    type: String,
  },
  songs: [{
    id: String,
    name: String,
    artist: String,
    album: String,
    duration: Number,
    preview_url: String,
    external_url: String,
    image: String,
    popularity: Number
  }],
  selectedAccentColor: {
    type: String,
    default: '#3b82f6'
  },
  youtubeVideo: {
    id: String,
    title: String,
    description: String,
    thumbnail: String,
    channelTitle: String,
    publishedAt: String,
    url: String,
    embedUrl: String
  },
  features: [{
    id: String,
    title: String,
    description: String,
    link: String,
    imageUrl: String
  }],
  isRecurring: {
    type: Boolean,
    default: false,
  },
  showOnExplore: {
    type: Boolean,
    default: true,
  },
  passwordProtected: {
    type: Boolean,
    default: false,
  },
  eventPassword: {
    type: String,
    select: false,
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled', 'completed'],
    default: 'draft',
  },
  attendees: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    ticketType: {
      type: String,
      required: true,
    },
    purchaseDate: {
      type: Date,
      default: Date.now,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
  }],
  totalRevenue: {
    type: Number,
    default: 0,
  },
  totalTicketsSold: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  // Live DJ Playlist Settings
  enableLivePlaylist: {
    type: Boolean,
    default: false,
  },
  livePlaylistSettings: {
    allowRequests: {
      type: Boolean,
      default: true,
    },
    requireApproval: {
      type: Boolean,
      default: true,
    },
    maxRequestsPerUser: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    votingEnabled: {
      type: Boolean,
      default: true,
    },
    autoPlayNext: {
      type: Boolean,
      default: false,
    },
  },
  // Payment Settings
  mcbJuiceNumber: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        // Optional field, but if provided, should be a valid phone number format
        return !v || /^(\+230\s?)?[0-9\s-]{8,15}$/.test(v);
      },
      message: 'Please enter a valid MCB Juice number (e.g., +230 5XXX XXXX)'
    }
  },
  organizerWhatsApp: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        // Optional field, but if provided, should be a valid phone number format
        return !v || /^(\+230\s?)?[0-9\s-]{8,15}$/.test(v);
      },
      message: 'Please enter a valid WhatsApp number (e.g., +230 5XXX XXXX)'
    }
  },
  accountNumber: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        // Optional field, but if provided, should be a valid bank account number
        return !v || /^[0-9]{10,20}$/.test(v);
      },
      message: 'Please enter a valid bank account number (10-20 digits)'
    }
  },
});

// Update the updatedAt field before saving
eventSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Calculate total revenue and tickets sold
eventSchema.methods.calculateTotals = function() {
  this.totalTicketsSold = this.attendees.reduce((total, attendee) => total + attendee.quantity, 0);
  this.totalRevenue = this.attendees.reduce((total, attendee) => {
    const ticketType = this.ticketTypes.find(t => t.name === attendee.ticketType);
    return total + (ticketType ? ticketType.price * attendee.quantity : 0);
  }, 0);
};

// Virtual for event duration
eventSchema.virtual('duration').get(function() {
  return this.endDate - this.startDate;
});

// Virtual for tickets available
eventSchema.virtual('totalTicketsAvailable').get(function() {
  return this.ticketTypes.reduce((total, ticket) => total + ticket.quantity, 0);
});

module.exports = mongoose.model('Event', eventSchema);
