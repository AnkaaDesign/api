#!/usr/bin/env node
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  keyPrefix: 'cache:',
});

async function clearWhatsAppCache() {
  try {
    console.log('Clearing WhatsApp credentials from Redis...');

    // Clear all WhatsApp Baileys keys
    const patterns = [
      'whatsapp:baileys:*',
      'whatsapp:qr',
      'whatsapp:status'
    ];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        console.log(`Found ${keys.length} keys matching ${pattern}`);
        await redis.del(...keys);
        console.log(`Deleted ${keys.length} keys`);
      } else {
        console.log(`No keys found for pattern: ${pattern}`);
      }
    }

    console.log('✅ WhatsApp cache cleared successfully!');
    console.log('Restart your application to generate fresh credentials.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await redis.quit();
  }
}

clearWhatsAppCache();
