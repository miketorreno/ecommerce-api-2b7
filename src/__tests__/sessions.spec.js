import request from 'supertest'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '#app.js'
import { createTestDatabase } from '#test/helpers/db.js'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }
const TEST_JWT_SECRET = 'test-jwt-secret'

function tokenFromEmailBody(body) {
  const match = body.match(/token=([A-Za-z0-9_-]+)/)
  if (match == null) throw new Error('no token found in email body')
  return match[1]
}

function cookieValue(res, name) {
  for (const entry of res.headers['set-cookie'] ?? []) {
    const [key, ...rest] = entry.split(';')[0].split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function cookieAttributes(res, name) {
  const entry = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`))
  if (entry == null) throw new Error(`no ${name} cookie set`)
  return entry.slice(entry.indexOf(';') + 1)
}

async function verificationTokenFor(db, email) {
  const { rows } = await db.pool.query(
    `SELECT body FROM email_events WHERE kind = 'email_verification' AND to_address = $1 ORDER BY created_at DESC LIMIT 1`,
    [email]
  )
  return tokenFromEmailBody(rows[0].body)
}

async function register(app, db, email, password = 'password123') {
  const res = await request(app).post('/v1/auth/register').send({ email, password })
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res
}

async function verifyAccount(app, db, email, password = 'password123') {
  await register(app, db, email, password)
  const token = await verificationTokenFor(db, email)
  const res = await request(app).post('/v1/auth/verify-email').send({ token })
  if (res.status !== 200)
    throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { token }
}

async function login(app, email, password = 'password123') {
  return request(app).post('/v1/auth/login').send({ email, password })
}

describe('sessions & access control', () => {
  let app
  let db

  beforeAll(async () => {
    db = await createTestDatabase()
    app = createApp({
      pool: db.pool,
      config: {
        appEnv: 'test',
        appUrl: 'https://shop.example.test',
        jwtSecret: TEST_JWT_SECRET,
      },
      logger: silentLogger,
    })
  })

  afterAll(async () => {
    await db?.drop()
  })

  describe('POST /v1/auth/login', () => {
    it('sets an httpOnly access cookie, an httpOnly refresh cookie, and a readable CSRF cookie', async () => {
      const email = 'session-start@example.com'
      await verifyAccount(app, db, email)

      const res = await login(app, email)

      expect(res.status).toBe(200)
      const access = cookieValue(res, 'access_token')
      const refresh = cookieValue(res, 'refresh_token')
      const csrf = cookieValue(res, 'csrf_token')
      expect(access).toEqual(expect.any(String))
      expect(refresh).toEqual(expect.any(String))
      expect(csrf).toEqual(expect.any(String))

      expect(cookieAttributes(res, 'access_token')).toMatch(/HttpOnly/)
      expect(cookieAttributes(res, 'access_token')).toMatch(/SameSite=Strict/)
      expect(cookieAttributes(res, 'refresh_token')).toMatch(/HttpOnly/)
      expect(cookieAttributes(res, 'refresh_token')).toMatch(/SameSite=Strict/)
      expect(cookieAttributes(res, 'csrf_token')).not.toMatch(/HttpOnly/)
      expect(cookieAttributes(res, 'csrf_token')).toMatch(/SameSite=Strict/)
    })

    it('keeps separate logins independent when one session logs out', async () => {
      const email = 'independent-sessions@example.com'
      await verifyAccount(app, db, email)
      const first = await login(app, email)
      const second = await login(app, email)
      const csrf = cookieValue(first, 'csrf_token')
      const loggedOut = await request(app)
        .post('/v1/auth/logout')
        .set('Cookie', `refresh_token=${cookieValue(first, 'refresh_token')}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(loggedOut.status).toBe(204)
      const otherSession = await request(app)
        .get('/v1/auth/me')
        .set('Cookie', `access_token=${cookieValue(second, 'access_token')}`)
      expect(otherSession.status).toBe(200)
      expect(otherSession.body.user.email).toBe(email)
    })
  })

  describe('POST /v1/auth/refresh', () => {
    it('rotates the refresh token and issues a fresh access token', async () => {
      const email = 'refresh@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      const loginRes = await agent.post('/v1/auth/login').send({ email, password: 'password123' })
      const csrf = cookieValue(loginRes, 'csrf_token')
      const oldRefresh = cookieValue(loginRes, 'refresh_token')

      const res = await agent.post('/v1/auth/refresh').set('X-CSRF-Token', csrf)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })
      const newRefresh = cookieValue(res, 'refresh_token')
      const newAccess = cookieValue(res, 'access_token')
      expect(newRefresh).not.toBe(oldRefresh)
      expect(newAccess).toEqual(expect.any(String))

      const revoked = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${oldRefresh}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)

      expect(revoked.status).toBe(401)
      expect(revoked.body).toMatchObject({
        type: 'about:blank',
        title: 'Invalid refresh token',
        status: 401,
      })
    })

    it('revokes the whole session when a spent refresh token is replayed', async () => {
      const email = 'replay@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      const loginRes = await agent.post('/v1/auth/login').send({ email, password: 'password123' })
      const csrf = cookieValue(loginRes, 'csrf_token')
      const firstRefresh = cookieValue(loginRes, 'refresh_token')

      const rotated = await agent.post('/v1/auth/refresh').set('X-CSRF-Token', csrf)
      const secondRefresh = cookieValue(rotated, 'refresh_token')
      expect(secondRefresh).not.toBe(firstRefresh)

      const replay = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${firstRefresh}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(replay.status).toBe(401)

      const stillRevoked = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${secondRefresh}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(stillRevoked.status).toBe(401)

      const savedAccess = await request(app)
        .get('/v1/auth/me')
        .set('Cookie', `access_token=${cookieValue(rotated, 'access_token')}`)
      expect(savedAccess.status).toBe(401)
    })
  })

  describe('POST /v1/auth/logout', () => {
    it('keeps a session revoked when logout overlaps refresh rotation', async () => {
      const email = 'concurrent-logout@example.com'
      await verifyAccount(app, db, email)
      const signedIn = await login(app, email)
      const csrf = cookieValue(signedIn, 'csrf_token')
      const original = cookieValue(signedIn, 'refresh_token')
      const rotated = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${original}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(rotated.status).toBe(200)
      const [loggedOut, refreshed] = await Promise.all([
        request(app)
          .post('/v1/auth/logout')
          .set('Cookie', `refresh_token=${original}; csrf_token=${csrf}`)
          .set('X-CSRF-Token', csrf),
        request(app)
          .post('/v1/auth/refresh')
          .set(
            'Cookie',
            `refresh_token=${cookieValue(rotated, 'refresh_token')}; csrf_token=${csrf}`
          )
          .set('X-CSRF-Token', csrf),
      ])
      expect(loggedOut.status).toBe(204)
      expect([200, 401]).toContain(refreshed.status)
      const latest = refreshed.status === 200 ? refreshed : rotated
      const me = await request(app)
        .get('/v1/auth/me')
        .set('Cookie', `access_token=${cookieValue(latest, 'access_token')}`)
      expect(me.status).toBe(401)
      const retry = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${cookieValue(latest, 'refresh_token')}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(retry.status).toBe(401)
    })

    it('revokes the session and clears the session cookies', async () => {
      const email = 'logout@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      const loginRes = await agent.post('/v1/auth/login').send({ email, password: 'password123' })
      const csrf = cookieValue(loginRes, 'csrf_token')
      const refresh = cookieValue(loginRes, 'refresh_token')

      const res = await agent.post('/v1/auth/logout').set('X-CSRF-Token', csrf)

      expect(res.status).toBe(204)
      const cleared = res.headers['set-cookie'].join(';')
      expect(cleared).toMatch(/access_token=;/)
      expect(cleared).toMatch(/refresh_token=;/)
      expect(cleared).toMatch(/csrf_token=;/)

      const reused = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `refresh_token=${refresh}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(reused.status).toBe(401)

      const me = await agent.get('/v1/auth/me')
      expect(me.status).toBe(401)

      const savedAccess = await request(app)
        .get('/v1/auth/me')
        .set('Cookie', `access_token=${cookieValue(loginRes, 'access_token')}`)
      expect(savedAccess.status).toBe(401)
    })
  })

  describe('CSRF protection', () => {
    it('rejects state-changing requests without a valid double-submit CSRF token', async () => {
      const email = 'csrf@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      await agent.post('/v1/auth/login').send({ email, password: 'password123' })

      const noHeader = await agent.post('/v1/auth/refresh')
      expect(noHeader.status).toBe(403)
      expect(noHeader.body).toMatchObject({
        type: 'about:blank',
        title: 'CSRF token missing or invalid',
        status: 403,
      })

      const wrong = await agent.post('/v1/auth/refresh').set('X-CSRF-Token', 'not-the-token')
      expect(wrong.status).toBe(403)
    })

    it('accepts a matching double-submit CSRF header for refresh', async () => {
      const email = 'csrf-ok@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      const loginRes = await agent.post('/v1/auth/login').send({ email, password: 'password123' })
      const csrf = cookieValue(loginRes, 'csrf_token')

      const res = await agent.post('/v1/auth/refresh').set('X-CSRF-Token', csrf)

      expect(res.status).toBe(200)
    })

    it('rejects logout without a valid CSRF token', async () => {
      const email = 'csrf-logout@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      await agent.post('/v1/auth/login').send({ email, password: 'password123' })

      const res = await agent.post('/v1/auth/logout')

      expect(res.status).toBe(403)
    })
  })

  describe('access token expiry', () => {
    it('renews an expired access token using a valid refresh token', async () => {
      const email = 'renew-expired@example.com'
      await verifyAccount(app, db, email)
      const signedIn = await login(app, email)
      const claims = jwt.verify(cookieValue(signedIn, 'access_token'), TEST_JWT_SECRET)
      expect(claims.exp - claims.iat).toBe(900)
      const expired = jwt.sign({ ...claims, exp: claims.iat - 1 }, TEST_JWT_SECRET)
      const csrf = cookieValue(signedIn, 'csrf_token')
      const refreshToken = cookieValue(signedIn, 'refresh_token')

      const before = await request(app).get('/v1/auth/me').set('Cookie', `access_token=${expired}`)
      expect(before.status).toBe(401)
      const renewed = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `access_token=${expired}; refresh_token=${refreshToken}; csrf_token=${csrf}`)
        .set('X-CSRF-Token', csrf)
      expect(renewed.status).toBe(200)
      const after = await request(app)
        .get('/v1/auth/me')
        .set('Cookie', `access_token=${cookieValue(renewed, 'access_token')}`)
      expect(after.status).toBe(200)
      expect(after.body.user.email).toBe(email)
    })

    it('rejects a request with an expired access token and no valid refresh', async () => {
      const email = 'expired-me@example.com'
      await verifyAccount(app, db, email)
      const { rows } = await db.pool.query('SELECT id FROM users WHERE email = $1', [email])

      const expired = jwt.sign(
        { role: 'customer', sub: rows[0].id, exp: Math.floor(Date.now() / 1000) - 60 },
        TEST_JWT_SECRET
      )

      const me = await request(app).get('/v1/auth/me').set('Cookie', `access_token=${expired}`)
      expect(me.status).toBe(401)
      expect(me.body).toMatchObject({
        type: 'about:blank',
        title: 'Access token expired or invalid',
        status: 401,
      })

      const refresh = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', `access_token=${expired}; csrf_token=t`)
        .set('X-CSRF-Token', 't')
      expect(refresh.status).toBe(401)
      expect(refresh.body.title).toBe('Invalid refresh token')
    })

    it('rejects refresh for a session whose user no longer exists without issuing tokens', async () => {
      const email = 'deleted-user@example.com'
      await verifyAccount(app, db, email)
      const signedIn = await login(app, email)
      const csrf = cookieValue(signedIn, 'csrf_token')

      await db.pool.query('DELETE FROM users WHERE email = $1', [email])

      const res = await request(app)
        .post('/v1/auth/refresh')
        .set(
          'Cookie',
          `refresh_token=${cookieValue(signedIn, 'refresh_token')}; csrf_token=${csrf}`
        )
        .set('X-CSRF-Token', csrf)

      expect(res.status).toBe(401)
      expect(res.body.title).toBe('Invalid refresh token')
      expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('rejects refresh with an expired refresh token', async () => {
      const email = 'expired-refresh@example.com'
      await verifyAccount(app, db, email)
      const signedIn = await login(app, email)
      const csrf = cookieValue(signedIn, 'csrf_token')

      await db.pool.query(
        `UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'
         WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
        [cookieValue(signedIn, 'refresh_token')]
      )

      const res = await request(app)
        .post('/v1/auth/refresh')
        .set(
          'Cookie',
          `refresh_token=${cookieValue(signedIn, 'refresh_token')}; csrf_token=${csrf}`
        )
        .set('X-CSRF-Token', csrf)

      expect(res.status).toBe(401)
      expect(res.body.title).toBe('Session expired')
    })
  })

  describe('admin role', () => {
    it('returns 403 for a customer-role session on an admin-only route', async () => {
      const email = 'customer@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      await agent.post('/v1/auth/login').send({ email, password: 'password123' })

      const res = await agent.get('/v1/admin/me')

      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403 })
    })

    it('allows an admin-role session onto an admin-only route', async () => {
      const email = 'boss@example.com'
      await verifyAccount(app, db, email)
      await db.pool.query('UPDATE users SET role = $2 WHERE email = $1', [email, 'admin'])
      const agent = request.agent(app)
      await agent.post('/v1/auth/login').send({ email, password: 'password123' })

      const res = await agent.get('/v1/admin/me')

      expect(res.status).toBe(200)
      expect(res.body.user).toMatchObject({ email, role: 'admin', verified: true })
    })

    it('returns 401 for an unauthenticated request', async () => {
      const res = await request(app).get('/v1/admin/me')

      expect(res.status).toBe(401)
    })
  })

  describe('GET /v1/auth/me', () => {
    it('returns the current user when a valid access cookie is present', async () => {
      const email = 'me@example.com'
      await verifyAccount(app, db, email)
      const agent = request.agent(app)
      await agent.post('/v1/auth/login').send({ email, password: 'password123' })

      const res = await agent.get('/v1/auth/me')

      expect(res.status).toBe(200)
      expect(res.body.user).toMatchObject({
        id: expect.any(String),
        email,
        role: 'customer',
        verified: true,
      })
      expect(res.body.user.verified_at).toEqual(expect.any(String))
    })

    it('returns problem+json 401 without an access cookie', async () => {
      const res = await request(app).get('/v1/auth/me')

      expect(res.status).toBe(401)
      expect(res.body).toMatchObject({
        type: 'about:blank',
        title: 'Authentication required',
        status: 401,
      })
    })
  })
})
