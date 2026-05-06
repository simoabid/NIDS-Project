import { Schema, model, type Model, type HydratedDocument } from 'mongoose'
import bcrypt from 'bcryptjs'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Raw document fields stored in MongoDB */
export interface IUser {
  email: string
  password: string          // bcrypt hash — never the plaintext
  role: 'admin' | 'viewer'
  createdAt: Date           // injected by { timestamps: true }
  updatedAt: Date
}

/** Instance methods available on every User document */
interface IUserMethods {
  /**
   * Compare a plaintext candidate against the stored bcrypt hash.
   * Use this in the login controller — never compare hashes manually.
   */
  comparePassword(candidate: string): Promise<boolean>
}

/** Static methods on the User model itself */
interface UserModel extends Model<IUser, Record<string, never>, IUserMethods> {
  /** Convenience finder — returns null if not found (never throws). */
  findByEmail(email: string): Promise<HydratedDocument<IUser, IUserMethods> | null>
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12   // ~250ms on modern hardware — good cost/security balance

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,   // normalise before storing so "Admin@X.com" === "admin@x.com"
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email format is invalid'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,     // excluded from queries by default — must opt-in with .select('+password')
    },

    role: {
      type: String,
      enum: {
        values: ['admin', 'viewer'],
        message: 'Role must be admin or viewer',
      },
      default: 'viewer',
    },
  },
  {
    timestamps: true,   // adds createdAt + updatedAt automatically
    versionKey: false,  // removes __v from documents
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Pre-save hook — hash password only when it has been modified
// ─────────────────────────────────────────────────────────────────────────────

// Mongoose 9 supports promise-based middleware — returning a Promise from a
// pre hook is equivalent to calling next(), and avoids the CallbackError typing.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return

  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS)
})

// ─────────────────────────────────────────────────────────────────────────────
// Instance methods
// ─────────────────────────────────────────────────────────────────────────────

userSchema.methods.comparePassword = async function (
  this: HydratedDocument<IUser, IUserMethods>,
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

// ─────────────────────────────────────────────────────────────────────────────
// Static methods
// ─────────────────────────────────────────────────────────────────────────────

userSchema.statics.findByEmail = function (
  email: string,
) {
  // exec() returns a real Promise with the correct HydratedDocument type
  // Explicitly select password back in so the auth controller can verify it
  return this.findOne({ email: email.toLowerCase().trim() }).select('+password').exec()
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

// The `unique: true` on email already creates an index.
// Add a compound index here if you add filtering by role later:
// userSchema.index({ role: 1, createdAt: -1 })

// ─────────────────────────────────────────────────────────────────────────────
// Model export
// ─────────────────────────────────────────────────────────────────────────────

const User = model<IUser, UserModel>('User', userSchema)
export default User
