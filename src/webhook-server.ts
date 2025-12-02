import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';

/**
 * Dedicated Webhook Server for backup progress
 * Runs on webhook.ankaa.live subdomain
 * Receives progress updates and broadcasts to connected clients
 */

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['https://ankaa.live', 'https://app.ankaa.live'],
    credentials: true,
  },
});

// Redis for pub/sub between API and webhook server
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

const redisSub = redis.duplicate();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook receiver endpoint for backup progress
app.post('/backup/progress', async (req, res) => {
  try {
    const { backupId, progress, filesProcessed, totalFiles, rate, timestamp, completed } = req.body;

    // Validate webhook signature (optional but recommended)
    const signature = req.headers['x-webhook-signature'];
    if (process.env.WEBHOOK_SECRET) {
      const expectedSignature = createHmacSignature(req.body, process.env.WEBHOOK_SECRET);
      if (signature !== expectedSignature) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Broadcast to Socket.io clients
    io.to(`backup-${backupId}`).emit('progress', {
      backupId,
      progress,
      filesProcessed,
      totalFiles,
      rate,
      timestamp,
      completed,
    });

    // Also publish to Redis for other services
    await redis.publish(
      'backup:progress',
      JSON.stringify({
        backupId,
        progress,
        filesProcessed,
        totalFiles,
        rate,
        timestamp,
        completed,
      }),
    );

    // Store latest progress in Redis (TTL 1 hour)
    await redis.setex(
      `backup:progress:${backupId}`,
      3600,
      JSON.stringify({
        progress,
        filesProcessed,
        totalFiles,
        rate,
        timestamp,
        completed,
      }),
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.io connection handling
io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe', async ({ backupId }) => {
    socket.join(`backup-${backupId}`);

    // Send latest progress if available
    const latestProgress = await redis.get(`backup:progress:${backupId}`);
    if (latestProgress) {
      socket.emit('progress', JSON.parse(latestProgress));
    }
  });

  socket.on('unsubscribe', ({ backupId }) => {
    socket.leave(`backup-${backupId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Subscribe to Redis pub/sub for cross-server communication
redisSub.subscribe('backup:progress');
redisSub.on('message', (channel, message) => {
  if (channel === 'backup:progress') {
    const data = JSON.parse(message);
    io.to(`backup-${data.backupId}`).emit('progress', data);
  }
});

// Helper function to create HMAC signature
function createHmacSignature(payload: any, secret: string): string {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

const PORT = process.env.WEBHOOK_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log('Configure nginx to proxy webhook.ankaa.live to this port');
});

export default httpServer;
