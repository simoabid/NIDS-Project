import { Schema, model, type Model } from 'mongoose'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Severity levels derived from attackType — not stored by the AI service. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Alert status lifecycle — defaults to 'new', managed by admins. */
export type AlertStatus = 'new' | 'acknowledged' | 'resolved' | 'false_positive'

/**
 * Raw document fields stored in MongoDB.
 * Mirrors the AlertPayload the AI service publishes to the `alerts` channel,
 * plus persistence-only fields (severity, status) for dashboard management.
 */
export interface IAlert {
  // ── Fields from AI service AlertPayload ──────────────────────────────────
  sourceIp: string
  destinationIp: string
  sourcePort: number
  destinationPort: number
  protocol: string
  attackType: 'Normal' | 'DoS' | 'PortScan' | 'Unknown'
  confidence: number                 // 0.0 – 1.0
  packetSize: number                 // bytes
  timestamp: Date                    // parsed from the ISO 8601 string

  // ── Persistence-only fields ─────────────────────────────────────────────
  severity: Severity                 // derived from attackType at insert time
  status: AlertStatus                // admin lifecycle management
  acknowledgedBy: string | null      // userId of admin who acknowledged
  acknowledgedAt: Date | null

  // ── Mongoose timestamps ─────────────────────────────────────────────────
  createdAt: Date
  updatedAt: Date
}

/** Static methods on the Alert model */
interface AlertModel extends Model<IAlert> {
  /**
   * Derive severity from the attack classification.
   * Matches the AI service's mapping:
   *   DoS      → critical
   *   PortScan → high
   *   Unknown  → medium
   *   Normal   → low
   */
  deriveSeverity(attackType: string): Severity
}

// ─────────────────────────────────────────────────────────────────────────────
// Severity mapping — centralised so controllers can reuse it
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, Severity> = {
  DoS:      'critical',
  PortScan: 'high',
  Unknown:  'medium',
  Normal:   'low',
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const alertSchema = new Schema<IAlert, AlertModel>(
  {
    // ── AI service fields (exact mirror of AlertPayload) ──────────────────
    sourceIp: {
      type: String,
      required: [true, 'Source IP is required'],
      index: true,
    },

    destinationIp: {
      type: String,
      required: [true, 'Destination IP is required'],
      index: true,
    },

    sourcePort: {
      type: Number,
      default: 0,
    },

    destinationPort: {
      type: Number,
      default: 0,
    },

    protocol: {
      type: String,
      default: 'TCP',
      uppercase: true,
    },

    attackType: {
      type: String,
      required: [true, 'Attack type is required'],
      enum: {
        values: ['Normal', 'DoS', 'PortScan', 'Unknown'],
        message: 'Attack type must be Normal, DoS, PortScan, or Unknown',
      },
      index: true,
    },

    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },

    packetSize: {
      type: Number,
      default: 0,
    },

    timestamp: {
      type: Date,
      required: true,
      index: true,
    },

    // ── Persistence-only fields ──────────────────────────────────────────
    severity: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low', 'info'],
      default: 'low',
      index: true,
    },

    status: {
      type: String,
      enum: ['new', 'acknowledged', 'resolved', 'false_positive'],
      default: 'new',
      index: true,
    },

    acknowledgedBy: {
      type: String,
      default: null,
    },

    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,     // adds createdAt + updatedAt automatically
    versionKey: false,    // removes __v from documents
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Pre-save hook — auto-derive severity from attackType if not set explicitly
// ─────────────────────────────────────────────────────────────────────────────

alertSchema.pre('save', function () {
  if (this.isNew || this.isModified('attackType')) {
    this.severity = SEVERITY_MAP[this.attackType] ?? 'low'
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Static methods
// ─────────────────────────────────────────────────────────────────────────────

alertSchema.statics.deriveSeverity = function (attackType: string): Severity {
  return SEVERITY_MAP[attackType] ?? 'low'
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

// TTL index — automatically purge alerts older than 30 days.
// MongoDB runs the TTL monitor every 60 seconds and removes expired docs.
alertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

// Compound index for the dashboard's default query:
// "show me recent attacks, newest first, filtered by severity"
alertSchema.index({ attackType: 1, severity: 1, timestamp: -1 })

// Compound index for alert timeline / chart queries
alertSchema.index({ timestamp: -1, attackType: 1 })

// ─────────────────────────────────────────────────────────────────────────────
// Model export
// ─────────────────────────────────────────────────────────────────────────────

const Alert = model<IAlert, AlertModel>('Alert', alertSchema)
export default Alert
