import { createHash } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '#app.js'
import { createTestDatabase } from '#test/helpers/db.js'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function tokenFromEmailBody(body) {
  const match = body.match(/token=([A-Za-z0-9_-]+)/)
  if (match == null) throw new Error('no token found in email body')
  return match[1]
}

async function register(app, email, password = 'password123') {
  const res = await request(app).post('/v1/auth/register').send({ email, password })
  return res
}

async function verificationTokenFor(db, email) {
  const { rows } = await db.pool.query(
    `SELECT body FROM email_events WHERE kind = 'email_verification' AND to_address = $1 ORDER BY created_at DESC LIMIT 1`,
    [email]
  )
  return tokenFromEmailBody(rows[0].body)
}

async function verifyAccount(app, db, email, password = 'password123') {
  await register(app, email, password)
  const token = await verificationTokenFor(db, email)
  const verify = await request(app).post('/v1/auth/verify-email').send({ token })
  if (verify.status !== 200)
    throw new Error(`verify failed: ${verify.status} ${JSON.stringify(verify.body)}`)
  return { token }
}

describe('register & password auth', () => {
  let app
  let db

  beforeAll(async () => {
    db = await createTestDatabase()
    app = createApp({
      pool: db.pool,
      config: { appEnv: 'test', appUrl: 'https://shop.example.test' },
      logger: silentLogger,
    })
  })

  afterAll(async () => {
    await db?.drop()
  })

  describe('POST /v1/auth/register', () => {
    it('registers a customer and stores a hashed password', async () => {
      const email = 'ada@example.com'
      const res = await register(app, email, 'correct horse battery')

      expect(res.status).toBe(201)
      expect(res.body.user).toMatchObject({
        id: expect.any(String),
        email,
        role: 'customer',
        verified: false,
        verified_at: null,
      })

      const { rows } = await db.pool.query('SELECT password_hash FROM users WHERE email = $1', [
        email,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/)
      expect(rows[0].password_hash).not.toBe('correct horse battery')
      expect(rows[0].password_hash.length).toBeGreaterThan(50)
    })

    it('normalizes the email to lowercase', async () => {
      const res = await register(app, 'Grace.Hopper@Example.com')

      expect(res.status).toBe(201)
      expect(res.body.user.email).toBe('grace.hopper@example.com')

      const { rows } = await db.pool.query(
        'SELECT count(*)::int AS count FROM users WHERE email = $1',
        ['grace.hopper@example.com']
      )
      expect(rows[0].count).toBe(1)
    })

    it('issues a verification email carrying the account confirmation link', async () => {
      const email = 'linus@example.com'
      await register(app, email)

      const { rows } = await db.pool.query(
        `SELECT kind, to_address, subject, body FROM email_events WHERE kind = 'email_verification' AND to_address = $1`,
        [email]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        to_address: email,
        subject: 'Verify your email',
      })
      expect(rows[0].body).toContain('https://shop.example.test/v1/auth/verify-email?token=')
    })

    it('returns problem+json 409 for a duplicate email', async () => {
      const email = 'duplicate@example.com'
      await register(app, email)

      const again = await request(app)
        .post('/v1/auth/register')
        .send({ email, password: 'password123' })

      expect(again.status).toBe(409)
      expect(again.headers['content-type']).toContain('application/problem+json')
      expect(again.body).toMatchObject({
        type: 'about:blank',
        title: 'Email already registered',
        status: 409,
      })
    })

    it('returns problem+json 400 for malformed payloads', async () => {
      const cases = [
        { email: 'not-an-email', password: 'password123' },
        { email: 'missing@example.com' },
        { password: 'password123' },
        { email: 'short@example.com', password: 'short' },
        { email: '', password: '' },
      ]

      for (const body of cases) {
        const res = await request(app).post('/v1/auth/register').send(body)

        expect(res.status).toBe(400)
        expect(res.headers['content-type']).toContain('application/problem+json')
        expect(res.body).toMatchObject({
          type: 'about:blank',
          title: 'Invalid request body',
          status: 400,
        })
        expect(res.body.detail).toEqual(expect.any(String))
      }
    })
  })

  describe('email verification', () => {
    it('serves a confirmation page from the emailed link without consuming the token', async () => {
      const email = 'verify-me@example.com'
      await register(app, email)
      const token = await verificationTokenFor(db, email)

      for (let i = 0; i < 2; i++) {
        const res = await request(app).get('/v1/auth/verify-email').query({ token })

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/html')
        expect(res.text).toContain('action="/v1/auth/verify-email"')
        expect(res.text).toContain(`name="token" value="${token}"`)
      }

      const { rows } = await db.pool.query('SELECT verified_at FROM users WHERE email = $1', [
        email,
      ])
      expect(rows[0].verified_at).toBeNull()
    })

    it('confirms the account when the token is submitted from the emailed link', async () => {
      const email = 'verify-me@example.com'
      await register(app, email)
      const token = await verificationTokenFor(db, email)

      await request(app).get('/v1/auth/verify-email').query({ token })
      const res = await request(app).post('/v1/auth/verify-email').send({ token })

      expect(res.status).toBe(200)
      expect(res.body.user).toMatchObject({
        email,
        role: 'customer',
        verified: true,
      })
      expect(res.body.user.verified_at).toEqual(expect.any(String))

      const { rows } = await db.pool.query('SELECT verified_at FROM users WHERE email = $1', [
        email,
      ])
      expect(rows[0].verified_at).not.toBeNull()
    })

    it('accepts a token in the request body for API clients', async () => {
      const email = 'verify-body@example.com'
      await register(app, email)
      const token = await verificationTokenFor(db, email)

      const res = await request(app).post('/v1/auth/verify-email').send({ token })

      expect(res.status).toBe(200)
      expect(res.body.user.verified).toBe(true)
      expect(res.body.user.verified_at).toEqual(expect.any(String))
    })

    it('keeps an already-verified account logged-in-capable after a second confirmation attempt', async () => {
      const email = 'verify-twice@example.com'
      const { token } = await verifyAccount(app, db, email)

      const second = await request(app).post('/v1/auth/verify-email').send({ token })
      expect(second.status).toBe(400)
      expect(second.body).toMatchObject({
        type: 'about:blank',
        title: 'Token already used',
        status: 400,
      })

      const { rows } = await db.pool.query('SELECT verified_at FROM users WHERE email = $1', [
        email,
      ])
      expect(rows[0].verified_at).not.toBeNull()
    })

    it('returns problem+json 400 for an unknown token', async () => {
      const res = await request(app)
        .post('/v1/auth/verify-email')
        .send({ token: 'definitely-not-a-real-token' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ type: 'about:blank', title: 'Invalid token', status: 400 })
    })

    it('returns problem+json 400 for an expired token', async () => {
      await register(app, 'expired@example.com')

      const { rows } = await db.pool.query('SELECT id FROM users WHERE email = $1', [
        'expired@example.com',
      ])
      const rawToken = 'expired-but-valid-format-token-123'
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      await db.pool.query(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [rows[0].id, 'email_verification', tokenHash, new Date(Date.now() - 1000).toISOString()]
      )

      const res = await request(app).post('/v1/auth/verify-email').send({ token: rawToken })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ type: 'about:blank', title: 'Token expired', status: 400 })
    })

    it('returns problem+json 400 when the token is missing', async () => {
      const getRes = await request(app).get('/v1/auth/verify-email')
      const postRes = await request(app).post('/v1/auth/verify-email').send({})

      expect(getRes.status).toBe(400)
      expect(postRes.status).toBe(400)
      expect(getRes.headers['content-type']).toContain('application/problem+json')
    })
  })

  describe('POST /v1/auth/login', () => {
    it('rejects an unverified account', async () => {
      const email = 'unverified@example.com'
      await register(app, email)

      const res = await request(app).post('/v1/auth/login').send({ email, password: 'password123' })

      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({
        type: 'about:blank',
        title: 'Email not verified',
        status: 403,
      })
    })

    it('rejects a wrong password and an unknown email without revealing which', async () => {
      const email = 'wrongpass@example.com'
      await verifyAccount(app, db, email)

      const wrongPassword = await request(app)
        .post('/v1/auth/login')
        .send({ email, password: 'not the password' })
      expect(wrongPassword.status).toBe(401)

      const unknownEmail = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' })
      expect(unknownEmail.status).toBe(401)

      expect(wrongPassword.body.title).toBe(unknownEmail.body.title)
      expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail)
    })

    it('allows a verified account to log in', async () => {
      const email = 'logged-in@example.com'
      await verifyAccount(app, db, email)

      const res = await request(app).post('/v1/auth/login').send({ email, password: 'password123' })

      expect(res.status).toBe(200)
      expect(res.body.user).toMatchObject({
        email,
        role: 'customer',
        verified: true,
      })
      expect(res.body.user.id).toEqual(expect.any(String))
    })
  })

  describe('password reset', () => {
    it('issues a reset token by email without revealing account existence', async () => {
      const email = 'reset@example.com'
      await verifyAccount(app, db, email)

      const known = await request(app).post('/v1/auth/forgot-password').send({ email })
      expect(known.status).toBe(202)
      expect(known.body).toEqual({ status: 'ok' })

      const unknown = await request(app)
        .post('/v1/auth/forgot-password')
        .send({ email: 'does-not-exist@example.com' })
      expect(unknown.status).toBe(202)
      expect(unknown.body).toEqual({ status: 'ok' })

      const { rows } = await db.pool.query(
        `SELECT body FROM email_events WHERE kind = 'password_reset' AND to_address = $1`,
        [email]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].body).toContain('https://shop.example.test/v1/auth/reset-password?token=')

      const { rows: unknownRows } = await db.pool.query(
        `SELECT count(*)::int AS count FROM email_events WHERE to_address = 'does-not-exist@example.com'`
      )
      expect(unknownRows[0].count).toBe(0)
    })

    it('accepts a new password and requires it for future logins', async () => {
      const email = 'reset-full@example.com'
      await verifyAccount(app, db, email)

      await request(app).post('/v1/auth/forgot-password').send({ email })
      const { rows } = await db.pool.query(
        `SELECT body FROM email_events WHERE kind = 'password_reset' AND to_address = $1`,
        [email]
      )
      const token = tokenFromEmailBody(rows[0].body)

      const res = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token, password: 'brand-new-password' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })

      const oldLogin = await request(app)
        .post('/v1/auth/login')
        .send({ email, password: 'password123' })
      expect(oldLogin.status).toBe(401)

      const newLogin = await request(app)
        .post('/v1/auth/login')
        .send({ email, password: 'brand-new-password' })
      expect(newLogin.status).toBe(200)
    })

    it('invalidates every other outstanding reset token once one is used', async () => {
      const email = 'reset-invalidate@example.com'
      await verifyAccount(app, db, email)

      for (let i = 0; i < 2; i++) {
        await request(app).post('/v1/auth/forgot-password').send({ email })
      }
      const { rows } = await db.pool.query(
        `SELECT body FROM email_events WHERE kind = 'password_reset' AND to_address = $1 ORDER BY created_at`,
        [email]
      )
      const [first, second] = rows.map((row) => tokenFromEmailBody(row.body))

      const firstReset = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: first, password: 'new-password-1' })
      expect(firstReset.status).toBe(200)

      const secondReset = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: second, password: 'new-password-2' })
      expect(secondReset.status).toBe(400)
      expect(secondReset.body).toMatchObject({
        type: 'about:blank',
        title: 'Token already used',
        status: 400,
      })

      const login = await request(app)
        .post('/v1/auth/login')
        .send({ email, password: 'new-password-1' })
      expect(login.status).toBe(200)
    })

    it('returns problem+json 400 for an unknown or reused reset token', async () => {
      const email = 'reset-bad-token@example.com'
      await verifyAccount(app, db, email)
      await request(app).post('/v1/auth/forgot-password').send({ email })

      const { rows } = await db.pool.query(
        `SELECT body FROM email_events WHERE kind = 'password_reset' AND to_address = $1`,
        [email]
      )
      const token = tokenFromEmailBody(rows[0].body)

      const unknown = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: 'not-a-reset-token', password: 'new-password-1' })
      expect(unknown.status).toBe(400)
      expect(unknown.body.title).toBe('Invalid token')

      const first = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token, password: 'new-password-1' })
      expect(first.status).toBe(200)

      const reused = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token, password: 'new-password-2' })
      expect(reused.status).toBe(400)
      expect(reused.body.title).toBe('Token already used')
    })

    it('returns problem+json 400 for a malformed reset request', async () => {
      const res = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: 'some-token', password: 'short' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        type: 'about:blank',
        title: 'Invalid request body',
        status: 400,
      })

      const expired = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: 'no-password' })
      expect(expired.status).toBe(400)
    })
  })
})
