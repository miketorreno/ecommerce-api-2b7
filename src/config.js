import dotenv from 'dotenv'

dotenv.config()

const REQUIRED_VARS = ['APP_ENV', 'PORT', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'DATABASE_URL', 'ORIGIN']

export function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  }

  return {
    appEnv: env.APP_ENV,
    databaseUrl: env.DATABASE_URL,
    expiresIn: env.JWT_EXPIRES_IN,
    jwtSecret: env.JWT_SECRET,
    origin: env.ORIGIN,
    port: Number(env.PORT),
  }
}
