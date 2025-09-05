const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const router = express.Router();

// Configure Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Get access token (Client Credentials flow for public data)
const getAccessToken = async () => {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    return data.body['access_token'];
  } catch (error) {
    console.error('Error getting Spotify access token:', error);
    throw error;
  }
};

// Search for tracks
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Ensure we have a valid access token
    await getAccessToken();

    const searchResults = await spotifyApi.searchTracks(q, { limit: parseInt(limit) });
    
    const tracks = searchResults.body.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album.name,
      duration: track.duration_ms,
      preview_url: track.preview_url,
      external_url: track.external_urls.spotify,
      image: track.album.images[0]?.url || null,
      popularity: track.popularity
    }));

    res.json({
      success: true,
      tracks: tracks,
      total: searchResults.body.tracks.total
    });
  } catch (error) {
    console.error('Spotify search error:', error);
    res.status(500).json({ error: 'Failed to search Spotify tracks' });
  }
});

// Get track details by ID
router.get('/track/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Ensure we have a valid access token
    await getAccessToken();

    const trackData = await spotifyApi.getTrack(id);
    const track = trackData.body;
    
    const trackInfo = {
      id: track.id,
      name: track.name,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album.name,
      duration: track.duration_ms,
      preview_url: track.preview_url,
      external_url: track.external_urls.spotify,
      image: track.album.images[0]?.url || null,
      popularity: track.popularity
    };

    res.json({
      success: true,
      track: trackInfo
    });
  } catch (error) {
    console.error('Spotify track fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch track details' });
  }
});

module.exports = router;
