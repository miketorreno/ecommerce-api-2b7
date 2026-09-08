import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '#app.js'
import { createPool } from '#db/pool.js'
import { createTestDatabase } from '#test/helpers/db.js'

describe('GET /healthz', () => {
  let app
  let db

  beforeAll(async () => {
    db = await createTestDatabase()
    app = createApp({ pool: db.pool, config: { appEnv: 'test' } })
  })

  afterAll(async () => {
    await db?.drop()
  })

  it('returns 200 when the database is reachable', async () => {
    const res = await request(app).get('/healthz')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns 503 when the database is unreachable', async () => {
    const deadPool = createPool({
      connectionString: 'postgresql://localhost:59999/nothing',
    })
    const deadApp = createApp({ pool: deadPool, config: { appEnv: 'test' } })

    const res = await request(deadApp).get('/healthz')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'error' })

    await deadPool.end()
  })
})
