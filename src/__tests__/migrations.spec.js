import { describe, expect, it } from 'vitest'

import { runMigrations } from '#db/migrate.js'
import { createTestDatabase } from '#test/helpers/db.js'

describe('migrations', () => {
  it('apply against a fresh database and are idempotent', async () => {
    const db = await createTestDatabase(process.env.DATABASE_URL)
    try {
      const { rows } = await db.pool.query('SELECT name FROM schema_migrations ORDER BY name')
      expect(rows.map((row) => row.name)).toEqual([
        '0001_init.sql',
        '0002_catalog.sql',
        '0003_seed_catalog.sql',
      ])

      await runMigrations(db.pool)

      const { rows: after } = await db.pool.query(
        'SELECT count(*)::int AS count FROM schema_migrations'
      )
      expect(after[0].count).toBe(3)
    } finally {
      await db.drop()
    }
  })
})
