import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js';
import { issueWebSocketTicket } from '../realtime/realtime.js';

const realtimeRouter = Router();
realtimeRouter.post('/ticket', authMiddleware, (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }
  return res.json({ ticket: issueWebSocketTicket(req.userId) });
});

export default realtimeRouter;
