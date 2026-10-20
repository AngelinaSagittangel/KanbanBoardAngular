
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
    authMiddleware,
    type AuthRequest,
} from '../middleware/auth.middleware.js';

const notificationsRouter = Router();

notificationsRouter.use(authMiddleware);
notificationsRouter.get('/', async (req, res) => {
    const userId = (req as AuthRequest).userId;

    if (!userId) {
        res.status(401).json({ message: 'Необходима авторизация' });
        return;
    }

    try {
        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: { recipientId: userId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
            prisma.notification.count({
                where: {
                    recipientId: userId,
                    readAt: null,
                },
            }),
        ]);

        res.json({ notifications, unreadCount });
    } catch (error) {
        console.error('Failed to load notifications:', error);
        res.status(500).json({ message: 'Не удалось загрузить уведомления' });
    }
});

notificationsRouter.patch('/:notificationId/read', async (req, res) => {
    const userId = (req as AuthRequest).userId;
    const { notificationId } = req.params;

    if (!userId) {
        res.status(401).json({ message: 'Необходима авторизация' });
        return;
    }

    try {
        const result = await prisma.notification.updateMany({
            where: {
                id: notificationId,
                recipientId: userId,
                readAt: null,
            },
            data: { readAt: new Date() },
        });

        if (result.count === 0) {
            const notification = await prisma.notification.findFirst({
                where: {
                    id: notificationId,
                    recipientId: userId,
                },
                select: { id: true },
            });

            if (!notification) {
                res.status(404).json({ message: 'Уведомление не найдено' });
                return;
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
        res.status(500).json({ message: 'Не удалось обновить уведомление' });
    }
});

notificationsRouter.patch('/read-all', async (req, res) => {
    const userId = (req as AuthRequest).userId;

    if (!userId) {
        res.status(401).json({ message: 'Необходима авторизация' });
        return;
    }

    try {
        await prisma.notification.updateMany({
            where: {
                recipientId: userId,
                readAt: null,
            },
            data: { readAt: new Date() },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
        res.status(500).json({ message: 'Не удалось обновить уведомления' });
    }
});

notificationsRouter.delete('/:notificationId', async (req, res) => {
    const userId = (req as AuthRequest).userId;
    const { notificationId } = req.params;

    if (!userId) {
        res.status(401).json({ message: 'Необходима авторизация' });
        return;
    }

    try {
        const result = await prisma.notification.deleteMany({
            where: {
                id: notificationId,
                recipientId: userId,
            },
        });

        if (result.count === 0) {
            res.status(404).json({ message: 'Уведомление не найдено' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete notification:', error);
        res.status(500).json({ message: 'Не удалось удалить уведомление' });
    }
});

notificationsRouter.delete('/', async (req, res) => {
    const userId = (req as AuthRequest).userId;

    if (!userId) {
        res.status(401).json({ message: 'Необходима авторизация' });
        return;
    }

    try {
        const result = await prisma.notification.deleteMany({
            where: { recipientId: userId },
        });

        res.json({
            success: true,
            deletedCount: result.count,
        });
    } catch (error) {
        console.error('Failed to delete all notifications:', error);
        res.status(500).json({ message: 'Не удалось удалить уведомления' });
    }
});

export default notificationsRouter;
