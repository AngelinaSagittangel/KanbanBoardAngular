import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'node:http';

import { prisma } from './lib/prisma.js';
import authRouter from './routes/auth.routes.js';
import boardsRouter from './routes/boards.routes.js';
import invitationsRouter from './routes/invitations.routes.js';
import realtimeRouter from './routes/realtime.routes.js';
import notificationsRouter from './routes/notifications.routes.js';
import cardActivityRouter from './routes/card-activity.routes.js';
import { attachRealtimeServer } from './realtime/realtime.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/realtime', realtimeRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/boards', cardActivityRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Kanban API is running',
  });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const server = createServer(app);
attachRealtimeServer(server);

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
