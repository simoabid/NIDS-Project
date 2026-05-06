import mongoose from 'mongoose';
import { env } from './env.js';
import logger from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB connection via Mongoose
// ─────────────────────────────────────────────────────────────────────────────

mongoose.connection.on('connected', () =>
  logger.info(`MongoDB connected: ${mongoose.connection.host}`),
);
mongoose.connection.on('error', (err) =>
  logger.error('MongoDB connection error', err),
);
mongoose.connection.on('disconnected', () =>
  logger.warn('MongoDB disconnected'),
);

export async function connectDB(): Promise<void> {
  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected gracefully');
}
