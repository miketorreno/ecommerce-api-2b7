import { Router } from 'express'
import { z } from 'zod'

import {
  clearSessionCookies,
  CSRF_COOKIE,
  DEFAULT_ACCESS_TTL_MS,
  DEFAULT_REFRESH_TTL_MS,
  REFRESH_COOKIE,
  setSessionCookies,
} from '#http/auth.js'
import { problemError, zodIssueDetail } from '#http/problem.js'

const registerSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
})

const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
})

const verifySchema = z.object({
  token: z.string().min(1).max(200),
})

const forgotPasswordSchema = z.object({
  email: z.email().trim().toLowerCase(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
})

function parseBody(schema, body) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw problemError(400, 'Invalid request body', zodIssueDetail(parsed.error.issues))
  }
  return parsed.data
}

export function createAuthRouter({ authService, authMiddleware, config = {} }) {
  const router = Router()
  const secure = (config.appEnv ?? process.env.APP_ENV) === 'production'
  const cookieTtl = {
    accessTtlMs: config.accessTokenTtlMs ?? DEFAULT_ACCESS_TTL_MS,
    refreshTtlMs: config.refreshTokenTtlMs ?? DEFAULT_REFRESH_TTL_MS,
  }

  router.post('/register', async (req, res) => {
    const { email, password } = parseBody(registerSchema, req.body)
    const user = await authService.register({ email, password })
    res.status(201).json({ user })
  })

  router.post('/login', async (req, res) => {
    const { email, password } = parseBody(loginSchema, req.body)
    const { user, accessToken, refreshToken, csrfToken } = await authService.login({
      email,
      password,
    })
    setSessionCookies(res, { accessToken, refreshToken, csrfToken, secure }, cookieTtl)
    res.json({ user })
  })

  router.post('/verify-email', async (req, res) => {
    const { token } = parseBody(verifySchema, req.body)
    const user = await authService.verifyEmail({ token })
    res.json({ user })
  })

  router.post('/refresh', authMiddleware.requireCsrf, async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw problemError(
        401,
        'Invalid refresh token',
        'This refresh token is not valid; log in again'
      )
    }

    const { accessToken, refreshToken: nextRefreshToken } = await authService.refresh({
      refreshToken,
    })
    setSessionCookies(
      res,
      {
        accessToken,
        refreshToken: nextRefreshToken,
        csrfToken: req.cookies?.[CSRF_COOKIE] ?? '',
        secure,
      },
      cookieTtl
    )
    res.json({ status: 'ok' })
  })

  router.post('/logout', authMiddleware.requireCsrf, async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      await authService.logout({ refreshToken })
    }
    clearSessionCookies(res, { secure })
    res.status(204).end()
  })

  router.get('/me', authMiddleware.requireAuth, async (req, res) => {
    const user = await authService.me({ userId: req.user.id })
    res.json({ user })
  })

  router.get('/verify-email', async (req, res) => {
    const { token } = parseBody(verifySchema, req.query)
    res.status(200).type('text/html').send(`<!doctype html>
<html lang="en">
  <body>
    <p>Confirming your email address.</p>
    <form id="confirm" method="post" action="/v1/auth/verify-email">
      <input type="hidden" name="token" value="${token}" />
      <noscript><button type="submit">Confirm email</button></noscript>
    </form>
    <script>document.getElementById('confirm').submit();</script>
  </body>
</html>`)
  })

  router.post('/forgot-password', async (req, res) => {
    const { email } = parseBody(forgotPasswordSchema, req.body)
    await authService.forgotPassword({ email })
    res.status(202).json({ status: 'ok' })
  })

  router.post('/reset-password', async (req, res) => {
    const { token, password } = parseBody(resetPasswordSchema, req.body)
    await authService.resetPassword({ token, password })
    res.json({ status: 'ok' })
  })

  return router
}
