import Redis from 'ioredis';

// Singleton ioredis client to be shared across the application.
// BullMQ and Redlock will use separate connections as required by their APIs.

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    // Automatically reconnect with exponential back-off up to 30 s
    retryStrategy(times) {
      const delay = Math.min(times * 200, 30_000);
      return delay;
    },
    // Fail fast for lock operations — callers handle the error
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('error', (err: Error) => {
    console.error('[Redis] connection error:', err.message);
  });

  client.on('connect', () => {
    console.info('[Redis] connected');
  });

  return client;
}

export const redis: Redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

export default redis;
