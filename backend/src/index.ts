import 'dotenv/config';
import http from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import logger from './config/logger.js';
import { initSocket } from './services/socketService.js';
import { startAlertSubscriber, stopAlertSubscriber } from './services/alertSubscriber.js';
import { startStatsBroadcaster, stopStatsBroadcaster } from './services/statsBroadcaster.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(app);

// Attach Socket.io to the HTTP server.
// Must happen BEFORE server.listen() so no connection is missed.
const io = initSocket(server);

// Suppress unused warning — io is exported via getIO() but held here for
// potential direct reference (e.g. graceful shutdown of WS connections).
void io;

async function start(): Promise<void> {
  try {
    // 1. Connect to data stores before accepting traffic
    await connectDB();
    await connectRedis();

    // 2. Start the alert subscriber (needs Redis + Socket.io ready)
    await startAlertSubscriber();

    // 3. Start the periodic stats broadcaster
    startStatsBroadcaster();

    // 4. Start listening
    server.listen(env.PORT, () => {
      logger.info(`🚀  Backend running on http://localhost:${env.PORT}`);
      logger.info(`    Environment : ${env.NODE_ENV}`);
      logger.info(`    AI Service  : ${env.AI_SERVICE_URL}`);
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown — handle SIGTERM (Docker stop) and SIGINT (Ctrl+C)
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down gracefully…`);

  server.close(async () => {
    stopStatsBroadcaster();
    await stopAlertSubscriber();
    await disconnectDB();
    await disconnectRedis();
    logger.info('Server closed. Goodbye.');
    process.exit(0);
  });

  // Force-kill if graceful shutdown takes more than 10 s
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — force exiting');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
  process.exit(1);
});

void start();
