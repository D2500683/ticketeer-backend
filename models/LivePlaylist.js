const mongoose = require('mongoose');

const songRequestSchema = new mongoose.Schema({
  spotifyTrackId: {
    type: String,
    required: true
  },
  trackName: {
    type: String,
    required: true
  },
  artist: {
    type: String,
    required: true
  },
  album: String,
  duration: Number,
  previewUrl: String,
  imageUrl: String,
  externalUrl: String,
  requesterName: {
    type: String,
    required: true
  },
  requesterEmail: {
    type: String,
    required: false
  },
  votes: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    voteType: {
      type: String,
      enum: ['up', 'down'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  voteScore: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'played'],
    default: 'pending'
  },
  playedAt: Date,
  requestedAt: {
    type: Date,
    default: Date.now
  }
});

const livePlaylistSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
    unique: true
  },
  djId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: false
  },
  currentTrack: {
    spotifyTrackId: String,
    trackName: String,
    artist: String,
    startedAt: Date,
    duration: Number
  },
  queue: [songRequestSchema],
  playHistory: [songRequestSchema],
  settings: {
    allowRequests: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: true
    },
    maxRequestsPerUser: {
      type: Number,
      default: 3
    },
    votingEnabled: {
      type: Boolean,
      default: true
    },
    autoPlayNext: {
      type: Boolean,
      default: false
    }
  },
  stats: {
    totalRequests: {
      type: Number,
      default: 0
    },
    totalVotes: {
      type: Number,
      default: 0
    },
    uniqueRequesters: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Index for efficient querying
livePlaylistSchema.index({ eventId: 1 });
livePlaylistSchema.index({ djId: 1 });
livePlaylistSchema.index({ 'queue.voteScore': -1 });

module.exports = mongoose.model('LivePlaylist', livePlaylistSchema);
