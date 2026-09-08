import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import morgan from 'morgan'

import { createHealthRepository } from './db/repositories/health.js'

export function createApp({ pool, config = {}, logger = console }) {
  const appEnv = config.appEnv ?? process.env.APP_ENV ?? 'development'
  const origin = config.origin ?? process.env.ORIGIN ?? '*'

  const app = express()

  const corsOptions = {
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 204,
    origin: appEnv == 'development' ? '*' : origin,
  }

  app.use(cors(corsOptions))
  if (appEnv !== 'test') app.use(morgan('dev')) // 'dev' | 'combined' | 'common' | 'short' | 'tiny'
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())

  const healthRepository = createHealthRepository(pool)

  app.get('/', (req, res) => {
    res.send('Welcome to the eCommerce API')
  })

  app.get('/healthz', async (req, res) => {
    try {
      await healthRepository.ping()
      res.status(200).json({ status: 'ok' })
    } catch (error) {
      logger.error({ error }, 'healthz check failed')
      res.status(503).json({ status: 'error' })
    }
  })

  return app
}
