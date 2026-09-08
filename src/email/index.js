export function createEmailService({ emailRepository, logger = console }) {
  return {
    async send({ userId = null, kind, to, subject, body, client }) {
      await emailRepository.insert({ userId, kind, to, subject, body }, client)
      logger.info({ email: { to, subject, kind } }, 'email sent')
    },
  }
}
