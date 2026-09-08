import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import morgan from 'morgan'

import { createCatalogRepository } from './db/repositories/catalog.js'
import { createHealthRepository } from './db/repositories/health.js'
import { sendProblem } from './http/problem.js'
import { createCatalogRouter } from './routes/catalog.js'

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
  const catalogRepository = createCatalogRepository(pool)

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

  app.use('/v1/catalog', createCatalogRouter({ catalogRepository }))

  app.use((req, res) => {
    sendProblem(res, {
      status: 404,
      title: 'Not Found',
      detail: `No route matches ${req.method} ${req.path}`,
    })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status ?? 500
    if (status >= 500) logger.error({ error }, 'unhandled error')
    sendProblem(res, {
      status,
      title: error.title ?? (status === 500 ? 'Internal Server Error' : 'Bad Request'),
      detail: status === 500 ? 'An unexpected error occurred' : error.message,
    })
  })

  return app
}
