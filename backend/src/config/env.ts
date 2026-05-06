import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Schema — every env var is validated at startup.
// If a required variable is missing the process exits immediately with a clear
// error message rather than crashing deep in application code.
// ─────────────────────────────────────────────────────────────────────────────
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform(Number),

  // MongoDB
  MONGO_URI: z.string().url({ message: 'MONGO_URI must be a valid URL' }),

  // Redis
  REDIS_URL: z.string().url({ message: 'REDIS_URL must be a valid URL' }),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // AI Service
  AI_SERVICE_URL: z.string().url({ message: 'AI_SERVICE_URL must be a valid URL' }),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),

  // Logging
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'debug'])
    .default('info'),

  // Audit
  AUDIT_LOG_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

// Parse and validate — exit on failure
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('\n❌  Invalid environment variables:\n');
  _parsed.error.issues.forEach((issue) => {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('\n   Fix the above values in your .env file and restart.\n');
  process.exit(1);
}

export const env = _parsed.data;
export type Env = typeof env;
