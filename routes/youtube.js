const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

// Configure YouTube API
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Search for YouTube videos
router.get('/search', async (req, res) => {
  try {
    const { q, maxResults = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const searchResponse = await youtube.search.list({
      part: 'snippet',
      q: q,
      type: 'video',
      maxResults: parseInt(maxResults),
      order: 'relevance',
      safeSearch: 'moderate'
    });

    const videos = searchResponse.data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`
    }));

    res.json({
      success: true,
      videos: videos,
      total: searchResponse.data.pageInfo.totalResults
    });
  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({ error: 'Failed to search YouTube videos' });
  }
});

// Get video details by ID
router.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!process.env.YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const videoResponse = await youtube.videos.list({
      part: 'snippet,statistics,contentDetails',
      id: id
    });

    if (!videoResponse.data.items.length) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videoResponse.data.items[0];
    const videoInfo = {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      thumbnail: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
      channelTitle: video.snippet.channelTitle,
      publishedAt: video.snippet.publishedAt,
      duration: video.contentDetails.duration,
      viewCount: video.statistics.viewCount,
      likeCount: video.statistics.likeCount,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      embedUrl: `https://www.youtube.com/embed/${video.id}`
    };

    res.json({
      success: true,
      video: videoInfo
    });
  } catch (error) {
    console.error('YouTube video fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch video details' });
  }
});

module.exports = router;
