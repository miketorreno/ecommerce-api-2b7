export function createEmailRepository(pool) {
  return {
    async insert({ userId = null, kind, to, subject, body }, client) {
      await (client ?? pool).query(
        `INSERT INTO email_events (user_id, kind, to_address, subject, body) VALUES ($1, $2, $3, $4, $5)`,
        [userId, kind, to, subject, body]
      )
    },
  }
}
