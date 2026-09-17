import { DEFAULT_ACCESS_TTL_MS, DEFAULT_REFRESH_TTL_MS } from '#config.js'
import { sendProblem } from '#http/problem.js'

export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'
export const CSRF_COOKIE = 'csrf_token'

export function createAuthMiddleware({ authService }) {
  async function requireAuth(req, res, next) {
    const token = req.cookies?.[ACCESS_COOKIE]
    if (typeof token !== 'string' || token.length === 0) {
      sendProblem(res, {
        status: 401,
        title: 'Authentication required',
        detail: 'Log in to access this resource',
      })
      return
    }

    req.user = await authService.authenticate({ accessToken: token })
    next()
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (req.user == null) {
        sendProblem(res, {
          status: 401,
          title: 'Authentication required',
          detail: 'Log in to access this resource',
        })
        return
      }
      if (req.user.role !== role) {
        sendProblem(res, {
          status: 403,
          title: 'Forbidden',
          detail: `This resource requires the ${role} role`,
        })
        return
      }
      next()
    }
  }

  function requireCsrf(req, res, next) {
    const cookie = req.cookies?.[CSRF_COOKIE]
    const header = req.get('X-CSRF-Token')
    if (typeof cookie !== 'string' || cookie.length === 0 || header !== cookie) {
      sendProblem(res, {
        status: 403,
        title: 'CSRF token missing or invalid',
        detail: 'Include a matching X-CSRF-Token header for this request',
      })
      return
    }
    next()
  }

  return { requireAuth, requireAdmin: requireRole('admin'), requireCsrf }
}

export function clearSessionCookies(res, { secure }) {
  const options = { httpOnly: true, sameSite: 'strict', secure, path: '/' }
  res.clearCookie(ACCESS_COOKIE, options)
  res.clearCookie(REFRESH_COOKIE, options)
  res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false })
}

export function setSessionCookies(
  res,
  { accessToken, refreshToken, csrfToken, secure },
  { accessTtlMs = DEFAULT_ACCESS_TTL_MS, refreshTtlMs = DEFAULT_REFRESH_TTL_MS } = {}
) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: accessTtlMs,
  })
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: refreshTtlMs,
  })
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: refreshTtlMs,
  })
}
