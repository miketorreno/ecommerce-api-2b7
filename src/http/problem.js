export function sendProblem(res, { status, title, detail, type = 'about:blank' }) {
  const body = { type, title, status }
  if (detail != null) body.detail = detail
  res.status(status).type('application/problem+json').json(body)
}

export function problemError(status, title, message) {
  const error = new Error(message)
  error.status = status
  error.title = title
  return error
}
