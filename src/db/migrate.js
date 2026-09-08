import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

const SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`

export async function runMigrations(pool) {
  await pool.query(SCHEMA_MIGRATIONS)

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort()

  const client = await pool.connect()
  try {
    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 AS applied FROM schema_migrations WHERE name = $1',
        [file]
      )
      if (rows.length > 0) continue

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
  }
}
