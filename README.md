# Ticketeer Backend

Node.js/Express backend API for the Ticketeer Community Hub - an event ticketing and management platform.

## Features

- **Event Management**: CRUD operations for events with image upload
- **User Authentication**: JWT-based auth with role-based access control
- **Payment Processing**: PayPal integration and MCB Juice manual payments
- **OCR Verification**: Automatic receipt verification using Tesseract.js
- **Live DJ Integration**: Real-time playlist management with Socket.IO
- **Email Services**: Automated ticket delivery and notifications
- **Admin Dashboard**: Order management and analytics
- **Spotify Integration**: Music search and playlist features

## Tech Stack

- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **Socket.IO** for real-time communication
- **JWT** for authentication
- **Cloudinary** for image storage
- **Tesseract.js** for OCR processing
- **PDFKit** for ticket generation
- **Nodemailer** for email delivery
- **Spotify Web API** for music integration

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- MongoDB database (local or cloud)
- Cloudinary account for image uploads
- PayPal Developer account (optional)
- Spotify Developer account (optional)
- Email service credentials (Gmail, etc.)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ticketeer-backend.git
cd ticketeer-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```
# Database
MONGODB_URI=mongodb://localhost:27017/ticketeer

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_here

# Cloudinary (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email Configuration
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# PayPal (optional)
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret

# Spotify (optional)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Server Configuration
PORT=3001
NODE_ENV=development
```

5. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify JWT token

### Events
- `GET /api/events` - Get all events
- `GET /api/events/:id` - Get event by ID
- `POST /api/events` - Create new event (auth required)
- `PUT /api/events/:id` - Update event (auth required)
- `DELETE /api/events/:id` - Delete event (auth required)

### Orders
- `POST /api/orders` - Create new order
- `GET /api/orders/user` - Get user orders (auth required)
- `POST /api/orders/verify-payment` - Verify payment screenshot
- `PUT /api/orders/:id/approve` - Approve order (admin)
- `PUT /api/orders/:id/reject` - Reject order (admin)

### Admin
- `GET /api/admin/orders/pending` - Get pending orders (admin)
- `GET /api/admin/orders/stats` - Get order statistics (admin)

### Live Playlist
- `GET /api/playlist/:eventId` - Get event playlist
- `POST /api/playlist/:eventId/songs` - Add song request
- `PUT /api/playlist/:eventId/songs/:songId/vote` - Vote on song
- `PUT /api/playlist/:eventId/songs/:songId/approve` - Approve song (DJ)

### Spotify
- `GET /api/spotify/search` - Search Spotify tracks
- `GET /api/spotify/track/:id` - Get track details

### Upload
- `POST /api/upload/image` - Upload image to Cloudinary
- `DELETE /api/upload/image/:publicId` - Delete image from Cloudinary

## Project Structure

```
├── middleware/          # Express middleware
├── models/             # Mongoose models
├── routes/             # API route handlers
├── services/           # Business logic services
├── uploads/            # Temporary file uploads
├── index.js            # Main server file
└── package.json        # Dependencies and scripts
```

## Key Features

### Payment Processing
- Progressive OCR verification with confidence scoring
- Automatic approval for high-confidence payments
- Admin review system for unclear payments
- Email notifications and ticket generation

### Live DJ Integration
- Real-time song requests and voting
- Socket.IO for live updates
- DJ approval system
- Playlist management

### Security
- JWT authentication
- Input sanitization
- Rate limiting
- Helmet security headers
- CORS configuration

## Environment Setup

### MongoDB
Set up a MongoDB database locally or use MongoDB Atlas cloud service.

### Cloudinary
1. Create account at cloudinary.com
2. Get your cloud name, API key, and API secret
3. Add to environment variables

### Email Service
Configure Gmail or other SMTP service for sending tickets and notifications.

### PayPal (Optional)
1. Create developer account at developer.paypal.com
2. Create sandbox application
3. Get client ID and secret

### Spotify (Optional)
1. Create developer account at developer.spotify.com
2. Create application
3. Get client ID and secret

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.
