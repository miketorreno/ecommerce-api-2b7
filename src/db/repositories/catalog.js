import { z } from 'zod'

const productListItemRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  min_price: z.number().int().nonnegative(),
  max_price: z.number().int().nonnegative(),
  currency: z.string().length(3),
  max_currency: z.string().length(3),
})

const browseRowSchema = productListItemRowSchema.extend({
  created_at: z.string(),
})

const searchRowSchema = productListItemRowSchema.extend({
  rank: z.number(),
})

const productRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  description: z.string(),
})

const variantRowSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  price_amount: z.number().int().nonnegative(),
  price_currency: z.string().length(3),
  stock: z.number().int().nonnegative(),
  availability: z.number().int(),
})

export const cursorSchema = z
  .object({
    version: z.literal(1),
    sort: z.enum(['time', 'rank']),
    time: z.string().optional(),
    rank: z.number().optional(),
    id: z.string().uuid(),
  })
  .refine((c) => (c.sort === 'time' ? c.time != null : c.rank != null), {
    message: 'cursor is missing its position',
  })

export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(value) {
  const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  return cursorSchema.parse(payload)
}

function toListItem(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    price: { amount: row.min_price, currency: row.currency },
    max_price: { amount: row.max_price, currency: row.max_currency },
  }
}

function buildFilters({ category, minPrice, maxPrice }, params) {
  const where = []
  if (category != null) {
    params.push(category)
    where.push(`p.category = $${params.length}`)
  }
  if (minPrice != null) {
    params.push(minPrice)
    where.push(`pp.min_price >= $${params.length}`)
  }
  if (maxPrice != null) {
    params.push(maxPrice)
    where.push(`pp.min_price <= $${params.length}`)
  }
  return where
}

export function createCatalogRepository(pool) {
  return {
    async listProducts({
      limit,
      cursor = null,
      category = null,
      minPrice = null,
      maxPrice = null,
      query = null,
    }) {
      const hasQuery = typeof query === 'string' && query.trim().length > 0

      const params = []
      const where = ['p.active = true']

      if (hasQuery) {
        params.push(query.trim())
        where.push(`p.search @@ websearch_to_tsquery('english', $1)`)
      }

      where.push(...buildFilters({ category, minPrice, maxPrice }, params))

      let cursorClause = ''
      let orderBy
      let rowSchema = browseRowSchema
      let selectExtra = ''
      const rankExpr = `ts_rank(p.search, websearch_to_tsquery('english', $1))`

      if (hasQuery) {
        rowSchema = searchRowSchema
        selectExtra = `, ${rankExpr} AS rank`
        if (cursor != null) {
          params.push(cursor.rank, cursor.id)
          cursorClause = `AND (${rankExpr}, p.id) < ($${params.length - 1}, $${params.length})`
        }
        orderBy = `ORDER BY ${rankExpr} DESC, p.id DESC`
      } else {
        selectExtra = `, p.created_at::text AS created_at`
        if (cursor != null) {
          params.push(cursor.time, cursor.id)
          cursorClause = `AND (p.created_at, p.id) < ($${params.length - 1}, $${params.length})`
        }
        orderBy = 'ORDER BY p.created_at DESC, p.id DESC'
      }

      const limitIndex = params.length + 1
      params.push(limit + 1)

      const sql = `
        WITH variant_prices AS (
          SELECT v.product_id, v.price_amount, v.price_currency
          FROM variants v
          WHERE v.active = true
        ),
        product_prices AS (
          SELECT
            product_id,
            (ARRAY_AGG(price_amount ORDER BY price_amount, price_currency))[1] AS min_price,
            (ARRAY_AGG(price_currency ORDER BY price_amount, price_currency))[1] AS currency,
            (ARRAY_AGG(price_amount ORDER BY price_amount DESC, price_currency DESC))[1] AS max_price,
            (ARRAY_AGG(price_currency ORDER BY price_amount DESC, price_currency DESC))[1] AS max_currency
          FROM variant_prices
          GROUP BY product_id
        )
        SELECT
          p.id,
          p.name,
          p.slug,
          p.category,
          pp.min_price,
          pp.max_price,
          pp.currency,
          pp.max_currency
          ${selectExtra}
        FROM products p
        JOIN product_prices pp ON pp.product_id = p.id
        WHERE ${where.join(' AND ')}
        ${cursorClause}
        ${orderBy}
        LIMIT $${limitIndex}
      `

      const { rows } = await pool.query(sql, params)

      const items = rows.slice(0, limit).map((row) => toListItem(rowSchema.parse(row)))
      const next = rows.length > limit ? rows[limit - 1] : null

      let next_cursor = null
      if (next != null) {
        next_cursor = encodeCursor(
          hasQuery
            ? { version: 1, sort: 'rank', rank: Number(next.rank), id: next.id }
            : { version: 1, sort: 'time', time: next.created_at, id: next.id }
        )
      }

      return { items, next_cursor }
    },

    async getProductBySlug(slug) {
      const productRes = await pool.query(
        `SELECT id, name, slug, category, description
         FROM products
         WHERE slug = $1 AND active = true`,
        [slug]
      )
      if (productRes.rows.length === 0) return null

      const product = productRowSchema.parse(productRes.rows[0])

      const variantsRes = await pool.query(
        `SELECT
           v.id,
           v.sku,
           v.name,
           v.price_amount,
           v.price_currency,
           COALESCE(s.quantity, 0) AS stock,
           GREATEST(COALESCE(s.quantity, 0) - COALESCE(r.reserved, 0), 0)::int AS availability
         FROM variants v
         LEFT JOIN stock s ON s.variant_id = v.id
         LEFT JOIN (
           SELECT variant_id, SUM(quantity)::int AS reserved
           FROM reservations
           WHERE released_at IS NULL AND expires_at > now()
           GROUP BY variant_id
         ) r ON r.variant_id = v.id
         WHERE v.product_id = $1 AND v.active = true
         ORDER BY v.name`,
        [product.id]
      )

      const variants = variantsRes.rows.map((row) => {
        const variant = variantRowSchema.parse(row)
        return {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          price: { amount: variant.price_amount, currency: variant.price_currency },
          stock: variant.stock,
          availability: variant.availability,
        }
      })

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        category: product.category,
        description: product.description,
        variants,
      }
    },
  }
}
