const express = require('express');
const router = express.Router();
const getColors = require('get-image-colors');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;

// Extract color palette from image
router.post('/extract', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Extract colors from image URL
    const colors = await getColors(imageUrl);
    
    // Convert colors to hex format with names
    const colorPalette = colors.map((color, index) => {
      const hex = color.hex();
      const rgb = color.rgb();
      
      // Generate descriptive names based on color properties
      let name = 'Color';
      const rgbArray = [rgb.r, rgb.g, rgb.b];
      const [r, g, b] = rgbArray;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      
      if (brightness > 200) {
        name = saturation > 50 ? 'Light Vibrant' : 'Light Muted';
      } else if (brightness < 80) {
        name = saturation > 50 ? 'Dark Vibrant' : 'Dark Muted';
      } else {
        name = saturation > 50 ? 'Vibrant' : 'Muted';
      }
      
      return {
        name: `${name} ${index + 1}`,
        hex: hex,
        rgb: rgbArray,
        population: 100 - index * 10 // Simulate population based on order
      };
    });

    res.json({
      success: true,
      colors: colorPalette.slice(0, 6), // Return top 6 colors
      imageUrl
    });

  } catch (error) {
    console.error('Color extraction error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to extract colors from image';
    if (error.message.includes('Unsupported file type') || error.message.includes('text/html')) {
      errorMessage = 'Invalid image URL or format. Please ensure the URL points directly to an image file.';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
      errorMessage = 'Unable to access the image. Please check the image URL.';
    } else if (error.message.includes('rgb.array is not a function')) {
      errorMessage = 'Color processing error. Please try uploading a different image.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message 
    });
  }
});

module.exports = router;
