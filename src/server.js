import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { createApp } from './app.js'
import { createLogger } from './logger.js'

const config = loadConfig()
const logger = createLogger()
const pool = createPool({ connectionString: config.databaseUrl })

const app = createApp({ pool, config, logger })

const server = app.listen(config.port, () => {
  logger.info(`listening on http://localhost:${config.port}`)
})

function shutdown(signal) {
  logger.info({ signal }, 'shutting down')
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
