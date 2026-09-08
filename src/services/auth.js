import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

import { problemError } from '#http/problem.js'

const BCRYPT_ROUNDS = 10
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

function generateToken() {
  return randomBytes(32).toString('base64url')
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    verified: user.verified_at != null,
    verified_at: user.verified_at,
  }
}

function tokenProblem(status) {
  switch (status) {
    case 'expired':
      return problemError(400, 'Token expired', 'This token has expired; request a new one')
    case 'used':
      return problemError(400, 'Token already used', 'This token has already been used')
    default:
      return problemError(400, 'Invalid token', 'This token is not recognized')
  }
}

export function createAuthService({ authRepository, emailService, config = {} }) {
  const verificationTtlMs = config.verificationTokenTtlMs ?? DAY_MS
  const resetTtlMs = config.resetTokenTtlMs ?? HOUR_MS
  const appUrl = config.appUrl ?? 'http://localhost:5000'

  return {
    async register({ email, password }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      const user = await authRepository.transaction(async (client) => {
        const created = await authRepository.createUser(
          { email, passwordHash, role: 'customer' },
          client
        )
        if (created == null) {
          throw problemError(
            409,
            'Email already registered',
            `A user with email "${email}" already exists`
          )
        }

        const token = generateToken()
        await authRepository.createAuthToken(
          {
            userId: created.id,
            purpose: 'email_verification',
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + verificationTtlMs),
          },
          client
        )

        await emailService.send({
          userId: created.id,
          kind: 'email_verification',
          to: email,
          subject: 'Verify your email',
          body: `Verify your email: ${appUrl}/v1/auth/verify-email?token=${token}`,
          client,
        })

        return created
      })

      return toPublicUser(user)
    },

    async verifyEmail({ token }) {
      const result = await authRepository.transaction(async (client) => {
        const consumed = await authRepository.consumeAuthToken(
          hashToken(token),
          'email_verification',
          client
        )
        if (consumed.status !== 'ok') return consumed
        const user = await authRepository.setVerified(consumed.userId, client)
        return { status: 'ok', user }
      })

      if (result.status !== 'ok') throw tokenProblem(result.status)
      return toPublicUser(result.user)
    },

    async login({ email, password }) {
      const user = await authRepository.findUserByEmail(email)
      if (user == null)
        throw problemError(401, 'Invalid credentials', 'Email or password is incorrect')

      const matches = await bcrypt.compare(password, user.password_hash)
      if (!matches) throw problemError(401, 'Invalid credentials', 'Email or password is incorrect')

      if (user.verified_at == null) {
        throw problemError(403, 'Email not verified', 'Verify your email before logging in')
      }

      return toPublicUser(user)
    },

    async forgotPassword({ email }) {
      const user = await authRepository.findUserByEmail(email)
      if (user == null) return

      const token = generateToken()
      await authRepository.transaction(async (client) => {
        await authRepository.createAuthToken(
          {
            userId: user.id,
            purpose: 'password_reset',
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + resetTtlMs),
          },
          client
        )

        await emailService.send({
          userId: user.id,
          kind: 'password_reset',
          to: email,
          subject: 'Reset your password',
          body: `Reset your password: ${appUrl}/v1/auth/reset-password?token=${token}`,
          client,
        })
      })
    },

    async resetPassword({ token, password }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      const result = await authRepository.transaction(async (client) => {
        const consumed = await authRepository.consumeAuthToken(
          hashToken(token),
          'password_reset',
          client
        )
        if (consumed.status !== 'ok') return consumed
        await authRepository.updatePassword(consumed.userId, passwordHash, client)
        await authRepository.invalidateUserTokens(consumed.userId, 'password_reset', client)
        return { status: 'ok' }
      })

      if (result.status !== 'ok') throw tokenProblem(result.status)
      return
    },
  }
}
