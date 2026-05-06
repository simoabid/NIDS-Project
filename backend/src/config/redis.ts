import Redis from 'ioredis';
import { env } from './env.js';
import logger from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Redis client — used for:
//   • Redis Streams  (consuming packets from the NIDS pipeline)
//   • Token blacklist (invalidated JWTs)
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,       // connect explicitly via redis.connect()
});

redis.on('connect', () => logger.info('Redis client connected'));
redis.on('ready',   () => logger.info('Redis client ready'));
redis.on('error',   (err) => logger.error('Redis error', err));
redis.on('close',   () => logger.warn('Redis connection closed'));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis disconnected gracefully');
}

export default redis;
