import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import morgan from 'morgan'
import dotenv from 'dotenv'

dotenv.config()

export const { APP_ENV, DATABASE_URL, JWT_EXPIRES_IN, JWT_SECRET, ORIGIN, PORT } = process.env

if (!APP_ENV || !PORT || !JWT_SECRET || !JWT_EXPIRES_IN || !DATABASE_URL || !ORIGIN) {
  throw new Error('Missing environment variables')
}

const app = express()

const corsOptions = {
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  optionsSuccessStatus: 204,
  origin: APP_ENV == 'development' ? '*' : ORIGIN,
}

app.use(cors(corsOptions))
app.use(morgan('dev')) // 'dev' | 'combined' | 'common' | 'short' | 'tiny'
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.get('/', (req, res) => {
  res.send('Welcome to the eCommerce API')
})

app.listen(PORT, () => {
  console.log(`🚀 listening on http://localhost:${PORT}`)
})
