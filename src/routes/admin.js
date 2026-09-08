import { Router } from 'express'

export function createAdminRouter({ authService }) {
  const router = Router()

  router.get('/me', async (req, res) => {
    const user = await authService.me({ userId: req.user.id })
    res.json({ user })
  })

  return router
}
