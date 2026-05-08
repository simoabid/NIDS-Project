import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import logger from './config/logger.js';
import { AppError } from './utils/AppError.js';
import authRoutes from './routes/authRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import captureRoutes from './routes/captureRoutes.js';
import auditRoutes from './routes/auditRoutes.js';

const app: Application = express();

// ─────────────────────────────────────────────────────────────────────────────
// Trust proxy — MUST be set when running behind Nginx so that:
//   • req.ip returns the real client IP (from X-Forwarded-For)
//   • express-rate-limit counts per real IP, not per Nginx container IP
//   • HTTPS detection works correctly via X-Forwarded-Proto
// ─────────────────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────────────
// Security & parsing middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());   // must come after body parsers; needed for HttpOnly refresh cookie

// ── Request ID middleware ──────────────────────────────────────────────────
// Assigns a unique ID to every request so logs across services can be
// correlated. Accepts an incoming X-Request-ID (e.g. from Nginx) or
// generates a fresh UUID if none is present.
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-ID', id);
  next();
});

// HTTP request logging (via winston stream)
app.use(
  morgan(':method :url :status :res[content-length] - :response-time ms | id::req[x-request-id]', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: () => env.NODE_ENV === 'test',
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter — applied globally; tighten per-route for auth endpoints
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 429, error: 'Too many requests, please try again later.' },
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Routes  (stubs — mounted as each module is implemented)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  const mongoose = require('mongoose') as { connection: { readyState: number } };
  const dbStates: Record<number, string> = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: 'ok',
    db:     dbStates[mongoose.connection.readyState] ?? 'unknown',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/alerts',    alertRoutes);
app.use('/api/capture',   captureRoutes);
app.use('/api/audit-log', auditRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: 404, error: 'Route not found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// Express requires all 4 parameters to recognise this as an error handler.
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Known HTTP errors — use their status code and message directly
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: err.statusCode,
      error:  err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  // Unknown errors — log the full stack, return generic 500 in production
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({
    status: 500,
    error: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

export default app;
