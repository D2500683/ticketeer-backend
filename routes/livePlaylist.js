const express = require('express');
const router = express.Router();
const LivePlaylist = require('../models/LivePlaylist');
const Event = require('../models/Event');
const authenticateToken = require('../middleware/authenticateToken');
const SpotifyWebApi = require('spotify-web-api-node');

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Get access token for Spotify API
async function getSpotifyAccessToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    return data.body['access_token'];
  } catch (error) {
    console.error('Error getting Spotify access token:', error);
    throw error;
  }
}

// Initialize or get live playlist for an event
router.post('/events/:eventId/playlist', authenticateToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Check if user owns the event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    if (event.organizer.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only event organizers can manage live playlists' });
    }

    // Check if playlist already exists
    let playlist = await LivePlaylist.findOne({ eventId });
    
    if (!playlist) {
      playlist = new LivePlaylist({
        eventId,
        djId: req.user.userId
      });
      await playlist.save();
    }

    res.json(playlist);
  } catch (error) {
    console.error('Error creating/getting live playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get live playlist for an event (public access for attendees)
router.get('/events/:eventId/playlist', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    const playlist = await LivePlaylist.findOne({ eventId })
      .populate('djId', 'username');
    
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found' });
    }

    // Sort queue by vote score (highest first)
    playlist.queue.sort((a, b) => b.voteScore - a.voteScore);

    res.json(playlist);
  } catch (error) {
    console.error('Error fetching live playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Request a song (for attendees) - No authentication required
router.post('/events/:eventId/playlist/request', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { spotifyTrackId } = req.body;

    const { requesterName, requesterEmail } = req.body;

    console.log('Song request received:', { eventId, spotifyTrackId, requesterName, requesterEmail });

    if (!spotifyTrackId) {
      return res.status(400).json({ error: 'Spotify track ID is required' });
    }

    if (!requesterName) {
      return res.status(400).json({ error: 'Requester name is required' });
    }

    // Get playlist
    const playlist = await LivePlaylist.findOne({ eventId });
    console.log('Playlist found:', playlist ? 'Yes' : 'No');
    
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found. Please ask the event organizer to enable the live playlist feature.' });
    }

    if (!playlist.settings.allowRequests) {
      return res.status(403).json({ error: 'Song requests are currently disabled' });
    }

    // Check if requester has reached request limit (by name/email)
    const userRequests = playlist.queue.filter(
      song => (song.requesterName === requesterName || (requesterEmail && song.requesterEmail === requesterEmail)) && song.status === 'pending'
    );
    
    if (userRequests.length >= playlist.settings.maxRequestsPerUser) {
      return res.status(400).json({ 
        error: `Maximum ${playlist.settings.maxRequestsPerUser} pending requests allowed per user` 
      });
    }

    // Check if song is already in queue
    const existingRequest = playlist.queue.find(
      song => song.spotifyTrackId === spotifyTrackId && song.status === 'pending'
    );
    
    if (existingRequest) {
      return res.status(400).json({ error: 'This song is already in the queue' });
    }

    // Get track details from Spotify
    let track;
    try {
      await getSpotifyAccessToken();
      const trackData = await spotifyApi.getTrack(spotifyTrackId);
      track = trackData.body;
    } catch (spotifyError) {
      console.error('Spotify API error:', spotifyError);
      return res.status(500).json({ error: 'Failed to fetch track details from Spotify' });
    }

    // Create song request
    const songRequest = {
      spotifyTrackId,
      trackName: track.name,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album.name,
      duration: track.duration_ms,
      previewUrl: track.preview_url,
      imageUrl: track.album.images[0]?.url,
      externalUrl: track.external_urls.spotify,
      requesterName,
      requesterEmail: requesterEmail || null,
      requestedAt: new Date(),
      status: playlist.settings.requireApproval ? 'pending' : 'approved',
      voteScore: 0,
      votes: []
    };

    playlist.queue.push(songRequest);
    playlist.stats.totalRequests += 1;
    
    // Update unique requesters count
    const uniqueRequesters = new Set(playlist.queue.map(song => song.requesterName));
    playlist.stats.uniqueRequesters = uniqueRequesters.size;

    await playlist.save();

    // Emit real-time update
    req.app.get('io').to(`event-${eventId}`).emit('songRequested', {
      eventId,
      song: songRequest,
      queueLength: playlist.queue.length
    });

    res.json({ message: 'Song requested successfully', song: songRequest });
  } catch (error) {
    console.error('Error requesting song:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      eventId,
      requesterName: req.body?.requesterName,
      spotifyTrackId: req.body?.spotifyTrackId
    });
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Vote on a song request
router.post('/events/:eventId/playlist/vote', authenticateToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { songId, voteType } = req.body;

    if (!['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'Vote type must be "up" or "down"' });
    }

    const playlist = await LivePlaylist.findOne({ eventId });
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found' });
    }

    if (!playlist.settings.votingEnabled) {
      return res.status(403).json({ error: 'Voting is currently disabled' });
    }

    const song = playlist.queue.id(songId);
    if (!song) {
      return res.status(404).json({ error: 'Song not found in queue' });
    }

    // Check if user already voted on this song
    const existingVoteIndex = song.votes.findIndex(
      vote => vote.userId.toString() === req.user.userId
    );

    if (existingVoteIndex !== -1) {
      // Update existing vote
      const existingVote = song.votes[existingVoteIndex];
      const oldVoteType = existingVote.voteType;
      
      if (oldVoteType === voteType) {
        return res.status(400).json({ error: 'You have already voted this way on this song' });
      }
      
      // Remove old vote effect and add new vote effect
      song.voteScore += voteType === 'up' ? 2 : -2; // Change from down to up (+2) or up to down (-2)
      existingVote.voteType = voteType;
      existingVote.timestamp = new Date();
    } else {
      // Add new vote
      song.votes.push({
        userId: req.user.userId,
        voteType,
        timestamp: new Date()
      });
      
      song.voteScore += voteType === 'up' ? 1 : -1;
      playlist.stats.totalVotes += 1;
    }

    await playlist.save();

    // Emit real-time update
    req.app.get('io').to(`event-${eventId}`).emit('songVoted', {
      eventId,
      songId,
      voteScore: song.voteScore,
      voteType,
      userId: req.user.userId
    });

    res.json({ 
      message: 'Vote recorded successfully', 
      voteScore: song.voteScore 
    });
  } catch (error) {
    console.error('Error voting on song:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DJ controls - approve/reject song
router.patch('/events/:eventId/playlist/songs/:songId', authenticateToken, async (req, res) => {
  try {
    const { eventId, songId } = req.params;
    const { status } = req.body; // 'approved', 'rejected', 'played'

    if (!['approved', 'rejected', 'played'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const playlist = await LivePlaylist.findOne({ eventId });
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found' });
    }

    // Check if user is the DJ
    if (playlist.djId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the DJ can manage song requests' });
    }

    const song = playlist.queue.id(songId);
    if (!song) {
      return res.status(404).json({ error: 'Song not found in queue' });
    }

    song.status = status;
    
    if (status === 'played') {
      song.playedAt = new Date();
      // Move to play history
      playlist.playHistory.push(song.toObject());
      playlist.queue.pull(songId);
    }

    await playlist.save();

    // Emit real-time update
    req.app.get('io').to(`event-${eventId}`).emit('songStatusChanged', {
      eventId,
      songId,
      status,
      playedAt: song.playedAt
    });

    res.json({ message: 'Song status updated successfully' });
  } catch (error) {
    console.error('Error updating song status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DJ controls - set current playing track
router.post('/events/:eventId/playlist/current', authenticateToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { spotifyTrackId, trackName, artist, duration } = req.body;

    const playlist = await LivePlaylist.findOne({ eventId });
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found' });
    }

    // Check if user is the DJ
    if (playlist.djId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the DJ can set current track' });
    }

    playlist.currentTrack = {
      spotifyTrackId,
      trackName,
      artist,
      startedAt: new Date(),
      duration
    };

    await playlist.save();

    // Emit real-time update
    req.app.get('io').to(`event-${eventId}`).emit('currentTrackChanged', {
      eventId,
      currentTrack: playlist.currentTrack
    });

    res.json({ message: 'Current track updated successfully' });
  } catch (error) {
    console.error('Error setting current track:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle playlist settings
router.patch('/events/:eventId/playlist/settings', authenticateToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const settings = req.body;

    const playlist = await LivePlaylist.findOne({ eventId });
    if (!playlist) {
      return res.status(404).json({ error: 'Live playlist not found' });
    }

    // Check if user is the DJ
    if (playlist.djId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the DJ can update settings' });
    }

    // Update settings
    Object.keys(settings).forEach(key => {
      if (playlist.settings[key] !== undefined) {
        playlist.settings[key] = settings[key];
      }
    });

    await playlist.save();

    // Emit real-time update
    req.app.get('io').to(`event-${eventId}`).emit('playlistSettingsChanged', {
      eventId,
      settings: playlist.settings
    });

    res.json({ message: 'Settings updated successfully', settings: playlist.settings });
  } catch (error) {
    console.error('Error updating playlist settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
