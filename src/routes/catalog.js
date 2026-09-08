import { Router } from 'express'
import { z } from 'zod'

import { decodeCursor } from '#db/repositories/catalog.js'
import { problemError, sendProblem } from '#http/problem.js'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  category: z.string().trim().min(1).optional(),
  min_price: z.coerce.number().int().nonnegative().optional(),
  max_price: z.coerce.number().int().nonnegative().optional(),
  q: z.string().trim().min(1).optional(),
})

function parseListQuery(query) {
  const parsed = listQuerySchema.safeParse(query)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw problemError(400, 'Invalid query parameters', detail)
  }

  const data = parsed.data
  if (data.min_price != null && data.max_price != null && data.min_price > data.max_price) {
    throw problemError(400, 'Invalid query parameters', 'min_price: must not exceed max_price')
  }

  return data
}

export function createCatalogRouter({ catalogRepository }) {
  const router = Router()

  router.get('/products', async (req, res) => {
    const {
      limit,
      cursor: cursorParam,
      category,
      min_price: minPrice,
      max_price: maxPrice,
      q: query,
    } = parseListQuery(req.query)

    let cursor = null
    if (cursorParam != null) {
      try {
        cursor = decodeCursor(cursorParam)
      } catch {
        throw problemError(400, 'Invalid query parameters', 'cursor: must be a valid cursor')
      }
      if ((cursor.sort === 'rank') !== (query != null)) {
        throw problemError(400, 'Invalid query parameters', 'cursor: does not match the query')
      }
    }

    const { items, next_cursor } = await catalogRepository.listProducts({
      limit,
      cursor,
      category,
      minPrice,
      maxPrice,
      query,
    })

    res.json({ items, next_cursor })
  })

  router.get('/products/:slug', async (req, res) => {
    const product = await catalogRepository.getProductBySlug(req.params.slug)
    if (product == null) {
      sendProblem(res, {
        status: 404,
        title: 'Product not found',
        detail: `No product matches slug "${req.params.slug}"`,
      })
      return
    }
    res.json(product)
  })

  return router
}
