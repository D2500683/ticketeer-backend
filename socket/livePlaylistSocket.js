const LivePlaylist = require('../models/LivePlaylist');

class LivePlaylistSocket {
  constructor(io) {
    this.io = io;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // Join event room for real-time updates
      socket.on('joinEvent', (eventId) => {
        socket.join(`event-${eventId}`);
        console.log(`Socket ${socket.id} joined event room: event-${eventId}`);
      });

      // Leave event room
      socket.on('leaveEvent', (eventId) => {
        socket.leave(`event-${eventId}`);
        console.log(`Socket ${socket.id} left event room: event-${eventId}`);
      });

      // DJ starts live session
      socket.on('startLiveSession', async (data) => {
        try {
          const { eventId, djId } = data;
          
          const playlist = await LivePlaylist.findOne({ eventId });
          if (!playlist || playlist.djId.toString() !== djId) {
            socket.emit('error', { message: 'Unauthorized or playlist not found' });
            return;
          }

          playlist.isActive = true;
          await playlist.save();

          // Notify all attendees that live session started
          this.io.to(`event-${eventId}`).emit('liveSessionStarted', {
            eventId,
            djName: data.djName,
            timestamp: new Date()
          });

          console.log(`Live session started for event ${eventId}`);
        } catch (error) {
          console.error('Error starting live session:', error);
          socket.emit('error', { message: 'Failed to start live session' });
        }
      });

      // DJ stops live session
      socket.on('stopLiveSession', async (data) => {
        try {
          const { eventId, djId } = data;
          
          const playlist = await LivePlaylist.findOne({ eventId });
          if (!playlist || playlist.djId.toString() !== djId) {
            socket.emit('error', { message: 'Unauthorized or playlist not found' });
            return;
          }

          playlist.isActive = false;
          playlist.currentTrack = {};
          await playlist.save();

          // Notify all attendees that live session ended
          this.io.to(`event-${eventId}`).emit('liveSessionEnded', {
            eventId,
            timestamp: new Date()
          });

          console.log(`Live session ended for event ${eventId}`);
        } catch (error) {
          console.error('Error stopping live session:', error);
          socket.emit('error', { message: 'Failed to stop live session' });
        }
      });

      // Real-time track progress updates from DJ
      socket.on('trackProgress', (data) => {
        const { eventId, progress, duration, trackId } = data;
        
        // Broadcast track progress to all attendees
        socket.to(`event-${eventId}`).emit('trackProgressUpdate', {
          eventId,
          progress,
          duration,
          trackId,
          timestamp: new Date()
        });
      });

      // DJ announces next song
      socket.on('announceNextSong', async (data) => {
        try {
          const { eventId, djId, nextSong } = data;
          
          const playlist = await LivePlaylist.findOne({ eventId });
          if (!playlist || playlist.djId.toString() !== djId) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
          }

          // Broadcast announcement to all attendees
          this.io.to(`event-${eventId}`).emit('nextSongAnnounced', {
            eventId,
            nextSong,
            timestamp: new Date()
          });

        } catch (error) {
          console.error('Error announcing next song:', error);
          socket.emit('error', { message: 'Failed to announce next song' });
        }
      });

      // Real-time chat for song requests and DJ interaction
      socket.on('sendMessage', async (data) => {
        try {
          const { eventId, userId, username, message, type } = data;
          
          const chatMessage = {
            id: Date.now().toString(),
            eventId,
            userId,
            username,
            message,
            type: type || 'chat', // 'chat', 'request', 'announcement'
            timestamp: new Date()
          };

          // Broadcast message to all attendees
          this.io.to(`event-${eventId}`).emit('newMessage', chatMessage);

        } catch (error) {
          console.error('Error sending message:', error);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // DJ live controls - skip song, pause, etc.
      socket.on('djControl', async (data) => {
        try {
          const { eventId, djId, action, payload } = data;
          
          const playlist = await LivePlaylist.findOne({ eventId });
          if (!playlist || playlist.djId.toString() !== djId) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
          }

          // Broadcast DJ control action to all attendees
          this.io.to(`event-${eventId}`).emit('djControlAction', {
            eventId,
            action, // 'skip', 'pause', 'resume', 'volume'
            payload,
            timestamp: new Date()
          });

          console.log(`DJ control action: ${action} for event ${eventId}`);
        } catch (error) {
          console.error('Error processing DJ control:', error);
          socket.emit('error', { message: 'Failed to process DJ control' });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
      });
    });
  }

  // Helper method to emit to specific event room
  emitToEvent(eventId, event, data) {
    this.io.to(`event-${eventId}`).emit(event, data);
  }

  // Get connected users count for an event
  getEventRoomSize(eventId) {
    const room = this.io.sockets.adapter.rooms.get(`event-${eventId}`);
    return room ? room.size : 0;
  }
}

module.exports = LivePlaylistSocket;
