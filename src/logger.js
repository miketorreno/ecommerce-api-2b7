import pino from 'pino'

export function createLogger(options = {}) {
  return pino(options)
}
