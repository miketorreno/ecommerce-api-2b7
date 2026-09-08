import { z } from 'zod'

const userRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  password_hash: z.string(),
  role: z.enum(['customer', 'admin']),
  verified_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const consumedTokenRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  purpose: z.enum(['email_verification', 'password_reset']),
  expires_at: z.string(),
  used_at: z.string().nullable(),
})

const userColumns =
  'id, email, password_hash, role, verified_at::text, created_at::text, updated_at::text'

export function createAuthRepository(pool) {
  return {
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async findUserByEmail(email, client) {
      const { rows } = await (client ?? pool).query(
        `SELECT ${userColumns} FROM users WHERE email = $1`,
        [email]
      )
      if (rows.length === 0) return null
      return userRowSchema.parse(rows[0])
    },

    async createUser({ email, passwordHash, role }, client) {
      try {
        const { rows } = await (client ?? pool).query(
          `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
           RETURNING ${userColumns}`,
          [email, passwordHash, role]
        )
        return userRowSchema.parse(rows[0])
      } catch (error) {
        if (error.code === '23505') return null
        throw error
      }
    },

    async setVerified(userId, client) {
      const { rows } = await (client ?? pool).query(
        `UPDATE users SET verified_at = now(), updated_at = now() WHERE id = $1
         RETURNING ${userColumns}`,
        [userId]
      )
      if (rows.length === 0) return null
      return userRowSchema.parse(rows[0])
    },

    async updatePassword(userId, passwordHash, client) {
      const { rows } = await (client ?? pool).query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1
         RETURNING ${userColumns}`,
        [userId, passwordHash]
      )
      if (rows.length === 0) return null
      return userRowSchema.parse(rows[0])
    },

    async createAuthToken({ userId, purpose, tokenHash, expiresAt }, client) {
      await (client ?? pool).query(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [userId, purpose, tokenHash, expiresAt]
      )
    },

    async consumeAuthToken(tokenHash, purpose, client) {
      const { rows } = await client.query(
        `SELECT id, user_id, purpose, expires_at::text, used_at::text
         FROM auth_tokens
         WHERE token_hash = $1 AND purpose = $2
         FOR UPDATE`,
        [tokenHash, purpose]
      )
      if (rows.length === 0) return { status: 'not_found' }

      const token = consumedTokenRowSchema.parse(rows[0])
      if (token.used_at != null) return { status: 'used' }
      if (new Date(token.expires_at).getTime() <= Date.now()) return { status: 'expired' }

      await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [token.id])
      return { status: 'ok', userId: token.user_id }
    },

    async invalidateUserTokens(userId, purpose, client) {
      await (client ?? pool).query(
        `UPDATE auth_tokens SET used_at = now()
         WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
        [userId, purpose]
      )
    },
  }
}
