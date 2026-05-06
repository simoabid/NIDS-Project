#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────────────────────────
// Admin seed script
// src/scripts/seed.ts
//
// Creates the first admin user if none exists.
// Run ONCE after the first docker-compose up:
//
//   npm run seed
//
// The script is idempotent — running it multiple times is safe.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import User from '../models/User.js'
import logger from '../config/logger.js'

// ── Default seed credentials ──────────────────────────────────────────────────
// Override via environment variables for non-interactive CI runs:
//   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=S3cur3! npm run seed
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@nids.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@NIDS2025!'

async function seed(): Promise<void> {
  logger.info('🌱  Starting database seed…')

  // ── Connect ───────────────────────────────────────────────────────────────
  await mongoose.connect(env.MONGO_URI)
  logger.info('📦  Connected to MongoDB')

  // ── Check for existing admin ──────────────────────────────────────────────
  const existingAdmin = await User.findOne({ role: 'admin' }).lean()

  if (existingAdmin) {
    logger.info(`✅  Admin user already exists (${existingAdmin.email}) — nothing to do.`)
    return
  }

  // ── Create admin ──────────────────────────────────────────────────────────
  // The User pre-save hook will hash the password before it is stored.
  const admin = new User({
    email:    ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role:     'admin',
  })

  await admin.save()

  logger.info('─'.repeat(60))
  logger.info('✅  Admin user created successfully!')
  logger.info(`   Email    : ${ADMIN_EMAIL}`)
  logger.info(`   Password : ${ADMIN_PASSWORD}`)
  logger.info('   ⚠️  Change this password immediately after first login.')
  logger.info('─'.repeat(60))
}

seed()
  .catch((err: unknown) => {
    logger.error('❌  Seed failed', err)
    process.exit(1)
  })
  .finally(async () => {
    await mongoose.disconnect()
    logger.info('Disconnected from MongoDB')
    process.exit(0)
  })
