import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '#app.js'
import { createTestDatabase } from '#test/helpers/db.js'

describe('catalog reads', () => {
  let app
  let db

  beforeAll(async () => {
    db = await createTestDatabase()
    app = createApp({ pool: db.pool, config: { appEnv: 'test' } })
  })

  afterAll(async () => {
    await db?.drop()
  })

  describe('GET /v1/catalog/products', () => {
    it('lists every active product with its lowest price as Money', async () => {
      const res = await request(app).get('/v1/catalog/products')
      const slugs = res.body.items.map((p) => p.slug)

      expect(res.status).toBe(200)
      expect(slugs).toEqual([
        'wool-overcoat',
        'wireless-mechanical-keyboard',
        'bamboo-cutting-board',
        'ceramic-espresso-cup',
        'everyday-canvas-tote',
        'alpine-flannel-shirt',
      ])
      expect(res.body.next_cursor).toBeNull()

      const overcoat = res.body.items.find((p) => p.slug === 'wool-overcoat')
      expect(overcoat).toMatchObject({
        id: expect.any(String),
        name: 'Wool Overcoat',
        category: 'apparel',
        price: { amount: 24900, currency: 'USD' },
      })

      const cup = res.body.items.find((p) => p.slug === 'ceramic-espresso-cup')
      expect(cup.price).toEqual({ amount: 1200, currency: 'USD' })
      expect(cup.max_price).toEqual({ amount: 1350, currency: 'USD' })
    })

    it('paginates with an opaque, stable cursor', async () => {
      const first = await request(app).get('/v1/catalog/products').query({ limit: 3 })

      expect(first.status).toBe(200)
      expect(first.body.items.map((p) => p.slug)).toEqual([
        'wool-overcoat',
        'wireless-mechanical-keyboard',
        'bamboo-cutting-board',
      ])
      expect(first.body.next_cursor).toEqual(expect.any(String))

      const cursor = first.body.next_cursor
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      expect(decoded).toMatchObject({ version: 1, sort: 'time', id: expect.any(String) })
      expect(cursor).not.toContain('wool-overcoat')

      const second = await request(app).get('/v1/catalog/products').query({ limit: 3, cursor })

      expect(second.status).toBe(200)
      expect(second.body.items.map((p) => p.slug)).toEqual([
        'ceramic-espresso-cup',
        'everyday-canvas-tote',
        'alpine-flannel-shirt',
      ])
      expect(second.body.next_cursor).toBeNull()

      const firstPage = first.body.items.map((p) => p.slug)
      const secondPage = second.body.items.map((p) => p.slug)
      expect([...firstPage, ...secondPage]).toEqual([
        'wool-overcoat',
        'wireless-mechanical-keyboard',
        'bamboo-cutting-board',
        'ceramic-espresso-cup',
        'everyday-canvas-tote',
        'alpine-flannel-shirt',
      ])
      expect(new Set([...firstPage, ...secondPage]).size).toBe(6)
    })

    it('filters by category', async () => {
      const res = await request(app).get('/v1/catalog/products').query({ category: 'home' })

      expect(res.status).toBe(200)
      expect(res.body.items.map((p) => p.slug)).toEqual([
        'bamboo-cutting-board',
        'ceramic-espresso-cup',
      ])
      for (const item of res.body.items) {
        expect(item.category).toBe('home')
      }
    })

    it('filters by price range on the lowest variant price', async () => {
      const min = await request(app).get('/v1/catalog/products').query({ min_price: 12000 })

      expect(min.status).toBe(200)
      expect(min.body.items.map((p) => p.slug)).toEqual(['wool-overcoat'])

      const max = await request(app).get('/v1/catalog/products').query({ max_price: 5000 })

      expect(max.status).toBe(200)
      expect(max.body.items.map((p) => p.slug)).toEqual([
        'bamboo-cutting-board',
        'ceramic-espresso-cup',
        'everyday-canvas-tote',
        'alpine-flannel-shirt',
      ])

      const both = await request(app)
        .get('/v1/catalog/products')
        .query({ min_price: 12000, max_price: 25000 })

      expect(both.status).toBe(200)
      expect(both.body.items.map((p) => p.slug)).toEqual(['wool-overcoat'])
    })

    it('searches products by keyword via tsvector', async () => {
      const keyboard = await request(app).get('/v1/catalog/products').query({ q: 'espresso' })

      expect(keyboard.status).toBe(200)
      expect(keyboard.body.items.map((p) => p.slug)).toEqual(['ceramic-espresso-cup'])

      const none = await request(app).get('/v1/catalog/products').query({ q: 'zzz-unknown-term' })

      expect(none.status).toBe(200)
      expect(none.body.items).toEqual([])
      expect(none.body.next_cursor).toBeNull()
    })

    it('composes search with category and price filters', async () => {
      const byPrice = await request(app)
        .get('/v1/catalog/products')
        .query({ q: 'cotton', min_price: 1500 })

      expect(byPrice.status).toBe(200)
      expect(byPrice.body.items.map((p) => p.slug)).toEqual(['alpine-flannel-shirt'])

      const byCategory = await request(app)
        .get('/v1/catalog/products')
        .query({ q: 'cotton', category: 'home' })

      expect(byCategory.status).toBe(200)
      expect(byCategory.body.items).toEqual([])
    })

    it('pages through search results without losing or repeating items', async () => {
      const seen = []
      const seenIds = new Set()
      let cursor = null

      for (let page = 0; page < 4; page++) {
        const query = cursor == null ? { q: 'cotton', limit: 1 } : { q: 'cotton', limit: 1, cursor }
        const res = await request(app).get('/v1/catalog/products').query(query)

        expect(res.status).toBe(200)
        seen.push(...res.body.items.map((p) => p.slug))
        for (const item of res.body.items) seenIds.add(item.id)
        if (res.body.next_cursor == null) break
        cursor = res.body.next_cursor
      }

      expect(seen.sort()).toEqual(['alpine-flannel-shirt', 'everyday-canvas-tote'])
      expect(seenIds.size).toBe(2)
    })
  })

  describe('GET /v1/catalog/products/:slug', () => {
    it('shows a product with its variants, prices, and availability', async () => {
      const res = await request(app).get('/v1/catalog/products/ceramic-espresso-cup')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        name: 'Ceramic Espresso Cup',
        slug: 'ceramic-espresso-cup',
        category: 'home',
        description: 'Two-tone ceramic cup sized for a double shot of espresso.',
      })

      const variants = Object.fromEntries(res.body.variants.map((v) => [v.sku, v]))
      expect(variants).toMatchObject({
        'CUP-CRM': {
          name: 'Cream',
          price: { amount: 1200, currency: 'USD' },
          stock: 40,
          availability: 40,
        },
        'CUP-SGE': { price: { amount: 1200, currency: 'USD' }, stock: 12, availability: 12 },
        'CUP-CBL': { price: { amount: 1350, currency: 'USD' }, stock: 0, availability: 0 },
      })
      expect(variants['CUP-CRM'].id).toEqual(expect.any(String))
    })

    it('computes availability as stock minus outstanding reservations, clamped at zero', async () => {
      await db.pool.query(
        `INSERT INTO reservations (variant_id, quantity, expires_at)
         SELECT id, 12, now() + interval '15 minutes' FROM variants WHERE sku = 'CUP-CRM'`
      )

      const res = await request(app).get('/v1/catalog/products/ceramic-espresso-cup')
      const cream = res.body.variants.find((v) => v.sku === 'CUP-CRM')

      expect(cream).toMatchObject({ stock: 40, availability: 28 })

      await db.pool.query(
        `UPDATE reservations SET released_at = now() WHERE variant_id = (SELECT id FROM variants WHERE sku = 'CUP-CRM')`
      )

      const after = await request(app).get('/v1/catalog/products/ceramic-espresso-cup')
      expect(after.body.variants.find((v) => v.sku === 'CUP-CRM')).toMatchObject({
        stock: 40,
        availability: 40,
      })
    })

    it('never reports a negative availability when reservations exceed stock', async () => {
      await db.pool.query(
        `INSERT INTO reservations (variant_id, quantity, expires_at)
         SELECT id, 7, now() + interval '15 minutes' FROM variants WHERE sku = 'KBD-LIN'`
      )
      await db.pool.query(
        `UPDATE stock SET quantity = 0 WHERE variant_id = (SELECT id FROM variants WHERE sku = 'KBD-LIN')`
      )

      const res = await request(app).get('/v1/catalog/products/wireless-mechanical-keyboard')
      const linear = res.body.variants.find((v) => v.sku === 'KBD-LIN')

      expect(linear).toMatchObject({ stock: 0, availability: 0 })
    })

    it('returns a problem+json 404 for an unknown slug', async () => {
      const res = await request(app).get('/v1/catalog/products/no-such-product')

      expect(res.status).toBe(404)
      expect(res.headers['content-type']).toContain('application/problem+json')
      expect(res.body).toMatchObject({
        type: 'about:blank',
        title: 'Product not found',
        status: 404,
      })
    })

    it('hides deactivated products from list and detail', async () => {
      await db.pool.query(`UPDATE products SET active = false WHERE slug = 'bamboo-cutting-board'`)

      const list = await request(app).get('/v1/catalog/products')
      expect(list.body.items.map((p) => p.slug)).not.toContain('bamboo-cutting-board')

      const detail = await request(app).get('/v1/catalog/products/bamboo-cutting-board')
      expect(detail.status).toBe(404)
    })
  })

  describe('request validation', () => {
    it('rejects invalid limit values with problem+json', async () => {
      for (const limit of [0, 101, 'abc', '-5']) {
        const res = await request(app).get('/v1/catalog/products').query({ limit })

        expect(res.status).toBe(400)
        expect(res.headers['content-type']).toContain('application/problem+json')
        expect(res.body).toMatchObject({
          title: 'Invalid query parameters',
          status: 400,
          type: 'about:blank',
        })
        expect(res.body.detail).toContain('limit')
      }
    })

    it('rejects negative prices and inverted price ranges', async () => {
      const negative = await request(app).get('/v1/catalog/products').query({ min_price: -1 })
      expect(negative.status).toBe(400)

      const inverted = await request(app)
        .get('/v1/catalog/products')
        .query({ min_price: 5000, max_price: 1000 })
      expect(inverted.status).toBe(400)
      expect(inverted.body.detail).toContain('min_price')
    })

    it('rejects a malformed cursor', async () => {
      const res = await request(app).get('/v1/catalog/products').query({ cursor: 'not-a-cursor' })

      expect(res.status).toBe(400)
      expect(res.body.detail).toContain('cursor')
    })

    it('rejects a cursor that does not match the request mode', async () => {
      const browseCursor = (await request(app).get('/v1/catalog/products').query({ limit: 1 })).body
        .next_cursor
      const searchCursor = (
        await request(app).get('/v1/catalog/products').query({ q: 'cotton', limit: 1 })
      ).body.next_cursor

      const searchWithBrowseCursor = await request(app)
        .get('/v1/catalog/products')
        .query({ q: 'cotton', cursor: browseCursor })
      expect(searchWithBrowseCursor.status).toBe(400)
      expect(searchWithBrowseCursor.body.detail).toContain('cursor')

      const browseWithSearchCursor = await request(app)
        .get('/v1/catalog/products')
        .query({ cursor: searchCursor })
      expect(browseWithSearchCursor.status).toBe(400)
    })

    it('returns problem+json 404 for unknown routes', async () => {
      const res = await request(app).get('/v1/catalog/nope')

      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({ type: 'about:blank', title: 'Not Found', status: 404 })
    })
  })
})
