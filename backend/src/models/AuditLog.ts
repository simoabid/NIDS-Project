import { Schema, model, type Model } from 'mongoose'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every auditable action in the system.
 * Organised by domain: auth, alert management, AI decisions, capture, users.
 */
export type AuditAction =
  // ── Authentication ──────────────────────────────────────────────────────
  | 'auth:login'
  | 'auth:logout'
  | 'auth:refresh'
  | 'auth:failed_login'
  // ── Alert management (admin actions on persisted alerts) ────────────────
  | 'alert:acknowledged'
  | 'alert:resolved'
  | 'alert:false_positive'
  // ── AI model decisions ("décisions du modèle" — spec requirement) ───────
  | 'ai:prediction'          // every classification the model makes
  | 'ai:detection'           // subset: attack-only predictions (DoS, PortScan)
  | 'ai:error'               // model failed to classify a flow
  // ── Capture lifecycle ──────────────────────────────────────────────────
  | 'capture:start'
  | 'capture:stop'
  | 'capture:upload'
  // ── User administration ────────────────────────────────────────────────
  | 'user:created'
  | 'user:role_changed'

/**
 * Raw document fields stored in MongoDB.
 * Tracks every security-relevant action for compliance and forensics.
 *
 * The PFE spec requires: "Système de logs dédié pour le suivi des alertes,
 * des décisions du modèle et des actions des administrateurs."
 */
export interface IAuditLog {
  /** userId of the actor — null for system-generated events */
  actor: string | null
  /** Email of the actor at the time of the action (denormalized for logs) */
  actorEmail: string | null
  /** Role of the actor at the time of the action */
  actorRole: 'admin' | 'viewer' | 'system'
  /** What happened */
  action: AuditAction
  /** What was acted upon — e.g. alertId, userId, interface name */
  targetId: string | null
  /** Type of the target resource */
  targetType: 'alert' | 'user' | 'capture' | 'session' | 'prediction' | null
  /** Free-form context — e.g. { ip: '192.168.1.1', userAgent: '...' } */
  metadata: Record<string, unknown>
  /** Client IP address from the request */
  ipAddress: string | null

  // ── Mongoose timestamps ─────────────────────────────────────────────────
  createdAt: Date
  updatedAt: Date
}

/** Static methods on the AuditLog model */
interface AuditLogModel extends Model<IAuditLog> {
  /**
   * Convenience factory — creates and saves an audit entry in one call.
   * Controllers call this after every significant action.
   */
  record(entry: Omit<IAuditLog, 'createdAt' | 'updatedAt'>): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const auditLogSchema = new Schema<IAuditLog, AuditLogModel>(
  {
    actor: {
      type: String,
      default: null,
      index: true,
    },

    actorEmail: {
      type: String,
      default: null,
    },

    actorRole: {
      type: String,
      enum: ['admin', 'viewer', 'system'],
      default: 'system',
    },

    action: {
      type: String,
      required: [true, 'Action is required'],
      enum: [
        'auth:login',
        'auth:logout',
        'auth:refresh',
        'auth:failed_login',
        'alert:acknowledged',
        'alert:resolved',
        'alert:false_positive',
        'ai:prediction',
        'ai:detection',
        'ai:error',
        'capture:start',
        'capture:stop',
        'capture:upload',
        'user:created',
        'user:role_changed',
      ],
      index: true,
    },

    targetId: {
      type: String,
      default: null,
    },

    targetType: {
      type: String,
      enum: ['alert', 'user', 'capture', 'session', 'prediction', null],
      default: null,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    ipAddress: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,     // adds createdAt + updatedAt automatically
    versionKey: false,    // removes __v from documents
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Static methods
// ─────────────────────────────────────────────────────────────────────────────

auditLogSchema.statics.record = async function (
  entry: Omit<IAuditLog, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  // Fire-and-forget — audit logging must never crash the request.
  // Errors are swallowed intentionally; Winston already logs them.
  try {
    await this.create(entry)
  } catch {
    // Silently fail — audit persistence should never block business logic
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

// TTL index — purge audit logs after 90 days (longer retention than alerts)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

// Compound index for "show me what this user did" queries
auditLogSchema.index({ actor: 1, createdAt: -1 })

// Compound index for "show me all actions of this type" queries
auditLogSchema.index({ action: 1, createdAt: -1 })

// Compound index for AI decision queries — "show me model decisions by target"
// Used by the audit log page to display what the AI classified and when
auditLogSchema.index({ action: 1, targetType: 1, createdAt: -1 })

// ─────────────────────────────────────────────────────────────────────────────
// Model export
// ─────────────────────────────────────────────────────────────────────────────

const AuditLog = model<IAuditLog, AuditLogModel>('AuditLog', auditLogSchema)
export default AuditLog
