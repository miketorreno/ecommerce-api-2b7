import dotenv from 'dotenv'
import pg from 'pg'

import { createPool } from '#db/pool.js'
import { runMigrations } from '#db/migrate.js'

dotenv.config()

export async function createTestDatabase(baseUrl = process.env.DATABASE_URL) {
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()

  const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()

  const url = new URL(baseUrl)
  url.pathname = `/${dbName}`

  const pool = createPool({ connectionString: url.toString() })
  await runMigrations(pool)

  return {
    pool,
    url: url.toString(),
    async drop() {
      await pool.end()
      const cleaner = new pg.Client({ connectionString: baseUrl })
      await cleaner.connect()
      await cleaner.query(`DROP DATABASE ${dbName}`)
      await cleaner.end()
    },
  }
}
