import { z } from 'zod'

export const pingRowSchema = z.object({ ok: z.number().int() })

export function createHealthRepository(pool) {
  return {
    async ping() {
      const { rows } = await pool.query('SELECT 1 AS ok')
      return pingRowSchema.parse(rows[0])
    },
  }
}
