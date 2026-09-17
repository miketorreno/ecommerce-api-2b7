import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'

import { DEFAULT_ACCESS_TTL_MS, DEFAULT_REFRESH_TTL_MS } from '#config.js'
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
  const jwtSecret = config.jwtSecret ?? process.env.JWT_SECRET
  const accessTokenTtlMs = config.accessTokenTtlMs ?? DEFAULT_ACCESS_TTL_MS
  const refreshTokenTtlMs = config.refreshTokenTtlMs ?? DEFAULT_REFRESH_TTL_MS

  function signAccessToken(user, sessionId) {
    return jwt.sign({ role: user.role, sid: sessionId }, jwtSecret, {
      subject: user.id,
      algorithm: 'HS256',
      expiresIn: Math.floor(accessTokenTtlMs / 1000),
    })
  }

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

      const sessionId = randomUUID()
      const refreshToken = generateToken()
      await authRepository.createRefreshToken({
        userId: user.id,
        sessionId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      })

      return {
        user: toPublicUser(user),
        accessToken: signAccessToken(user, sessionId),
        refreshToken,
        csrfToken: generateToken(),
      }
    },

    async authenticate({ accessToken }) {
      let claims
      try {
        claims = z
          .object({
            sub: z.string().uuid(),
            sid: z.string().uuid(),
            role: z.enum(['customer', 'admin']),
            exp: z.number().int(),
          })
          .parse(jwt.verify(accessToken, jwtSecret, { algorithms: ['HS256'] }))
      } catch {
        throw problemError(
          401,
          'Access token expired or invalid',
          'Refresh the session and try again'
        )
      }
      const active = await authRepository.isSessionActive({
        userId: claims.sub,
        sessionId: claims.sid,
      })
      if (!active) {
        throw problemError(401, 'Authentication required', 'This session no longer exists')
      }
      return { id: claims.sub, role: claims.role }
    },

    async me({ userId }) {
      const user = await authRepository.findUserById(userId)
      if (user == null)
        throw problemError(401, 'Authentication required', 'This session no longer exists')
      return toPublicUser(user)
    },

    async refresh({ refreshToken }) {
      const tokenHash = hashToken(refreshToken)

      const result = await authRepository.transaction(async (client) => {
        const token = await authRepository.findRefreshToken(tokenHash, client)
        if (token == null) return { status: 'invalid' }
        if (token.revoked_at != null) {
          await authRepository.revokeRefreshTokenSession(token.session_id, client)
          return { status: 'invalid' }
        }
        if (new Date(token.expires_at).getTime() <= Date.now()) return { status: 'expired' }

        const user = await authRepository.findUserById(token.user_id, client)
        if (user == null) return { status: 'invalid' }

        const nextRefreshToken = generateToken()
        await authRepository.revokeRefreshToken(token.id, client)
        await authRepository.createRefreshToken(
          {
            userId: token.user_id,
            sessionId: token.session_id,
            tokenHash: hashToken(nextRefreshToken),
            expiresAt: new Date(Date.now() + refreshTokenTtlMs),
          },
          client
        )
        return { status: 'ok', user, sessionId: token.session_id, refreshToken: nextRefreshToken }
      })

      if (result.status !== 'ok') {
        if (result.status === 'expired') {
          throw problemError(401, 'Session expired', 'This session has expired; log in again')
        }
        throw problemError(
          401,
          'Invalid refresh token',
          'This refresh token is not valid; log in again'
        )
      }

      return {
        user: toPublicUser(result.user),
        accessToken: signAccessToken(result.user, result.sessionId),
        refreshToken: result.refreshToken,
      }
    },

    async logout({ refreshToken }) {
      const tokenHash = hashToken(refreshToken)
      await authRepository.transaction(async (client) => {
        const token = await authRepository.findRefreshToken(tokenHash, client)
        if (token == null) return
        await authRepository.revokeRefreshTokenSession(token.session_id, client)
      })
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
