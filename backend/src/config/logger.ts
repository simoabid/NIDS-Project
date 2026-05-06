import winston from 'winston';
import { env } from './env';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// ─────────────────────────────────────────────────────────────────────────────
// Custom log format:  [TIMESTAMP] LEVEL: message  (stack trace on errors)
// ─────────────────────────────────────────────────────────────────────────────
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return stack
    ? `[${timestamp}] ${level}: ${message}\n${stack}`
    : `[${timestamp}] ${level}: ${message}`;
});

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),   // include stack trace for Error objects
    logFormat,
  ),
  transports: [
    // Console — colourised in development, plain JSON in production
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'development'
          ? combine(colorize({ all: true }), logFormat)
          : combine(timestamp(), winston.format.json()),
    }),
  ],
});

export default logger;
