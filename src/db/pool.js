import pg from 'pg'

export function createPool(options = {}) {
  return new pg.Pool(options)
}
