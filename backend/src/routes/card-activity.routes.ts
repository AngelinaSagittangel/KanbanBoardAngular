import {Router} from 'express';
import {z} from 'zod';

import {prisma} from '../lib/prisma.js';
import {
    authMiddleware,
    type AuthRequest,
} from '../middleware/auth.middleware.js';
import {broadcastBoardChange} from '../realtime/realtime.js';

const cardActivityRouter = Router();

cardActivityRouter.use(authMiddleware);

const createCommentSchema = z.object({
    content: z.string().trim().min(1).max(5000),
});

const updateCommentSchema = z.object({
    content: z.string().trim().min(1).max(5000),
});

async function getAccessibleCard(
    boardId: string,
    cardId: string,
    userId: string,
) {
    return prisma.card.findFirst({
        where: {
            id: cardId,
            column: {
                boardId,
                board: {
                    OR: [
                        {ownerId: userId},
                        {members: {some: {userId}}},
                    ],
                },
            },
        },
        select: {
            id: true,
            title: true,
            column: {
                select: {
                    boardId: true,
                },
            },
        },
    });
}

async function getActorName(userId: string): Promise<string> {
    const actor = await prisma.user.findUnique({
        where: {id: userId},
        select: {name: true},
    });

    return actor?.name ?? 'Пользователь';
}

cardActivityRouter.get(
    '/:boardId/cards/:cardId/activity',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);

            const card = await getAccessibleCard(
                boardId,
                cardId,
                req.userId!,
            );

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const activities = await prisma.cardActivity.findMany({
                where: {boardId, cardId},
                orderBy: {createdAt: 'desc'},
            });

            return res.json({activities});
        } catch (error) {
            console.error('Failed to load card activity:', error);

            return res.status(500).json({
                message: 'Не удалось загрузить историю карточки',
            });
        }
    },
);

cardActivityRouter.get(
    '/:boardId/cards/:cardId/comments',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);

            const card = await getAccessibleCard(
                boardId,
                cardId,
                req.userId!,
            );

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const comments = await prisma.comment.findMany({
                where: {cardId},
                orderBy: {createdAt: 'asc'},
                include: {
                    author: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });

            return res.json({comments});
        } catch (error) {
            console.error('Failed to load comments:', error);

            return res.status(500).json({
                message: 'Не удалось загрузить комментарии',
            });
        }
    },
);

cardActivityRouter.post(
    '/:boardId/cards/:cardId/comments',
    async (req: AuthRequest, res) => {
        const validation = createCommentSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Комментарий должен содержать от 1 до 5000 символов',
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);
            const userId = req.userId!;

            const card = await getAccessibleCard(boardId, cardId, userId);

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const actorName = await getActorName(userId);

            const comment = await prisma.$transaction(async (tx) => {
                const createdComment = await tx.comment.create({
                    data: {
                        content: validation.data.content,
                        cardId,
                        authorId: userId,
                    },
                    include: {
                        author: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });

                await tx.cardActivity.create({
                    data: {
                        boardId,
                        cardId,
                        actorId: userId,
                        actorName,
                        type: 'COMMENT_ADDED',
                        details: {
                            commentId: createdComment.id,
                            content: createdComment.content,
                        },
                    },
                });

                return createdComment;
            });

            broadcastBoardChange(boardId, {
                action: 'created',
                entity: 'card',
                entityId: cardId,
                actorId: userId,
            });

            return res.status(201).json({
                message: 'Комментарий добавлен',
                comment,
            });
        } catch (error) {
            console.error('Failed to create comment:', error);

            return res.status(500).json({
                message: 'Не удалось добавить комментарий',
            });
        }
    },
);

cardActivityRouter.patch(
    '/:boardId/cards/:cardId/comments/:commentId',
    async (req: AuthRequest, res) => {
        const validation = updateCommentSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Комментарий должен содержать от 1 до 5000 символов',
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);
            const commentId = String(req.params.commentId);
            const userId = req.userId!;

            const card = await getAccessibleCard(boardId, cardId, userId);

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const existingComment = await prisma.comment.findFirst({
                where: {id: commentId, cardId},
            });

            if (!existingComment) {
                return res.status(404).json({
                    message: 'Комментарий не найден',
                });
            }

            if (existingComment.authorId !== userId) {
                return res.status(403).json({
                    message: 'Можно редактировать только свои комментарии',
                });
            }

            const actorName = await getActorName(userId);

            const comment = await prisma.$transaction(async (tx) => {
                const updatedComment = await tx.comment.update({
                    where: {id: commentId},
                    data: {content: validation.data.content},
                    include: {
                        author: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });

                await tx.cardActivity.create({
                    data: {
                        boardId,
                        cardId,
                        actorId: userId,
                        actorName,
                        type: 'COMMENT_UPDATED',
                        details: {
                            commentId,
                            previousContent: existingComment.content,
                            content: updatedComment.content,
                        },
                    },
                });

                return updatedComment;
            });

            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'card',
                entityId: cardId,
                actorId: userId,
            });

            return res.json({
                message: 'Комментарий обновлён',
                comment,
            });
        } catch (error) {
            console.error('Failed to update comment:', error);

            return res.status(500).json({
                message: 'Не удалось изменить комментарий',
            });
        }
    },
);

cardActivityRouter.delete(
    '/:boardId/cards/:cardId/comments/:commentId',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);
            const commentId = String(req.params.commentId);
            const userId = req.userId!;

            const card = await getAccessibleCard(boardId, cardId, userId);

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const comment = await prisma.comment.findFirst({
                where: {id: commentId, cardId},
            });

            if (!comment) {
                return res.status(404).json({
                    message: 'Комментарий не найден',
                });
            }

            if (comment.authorId !== userId) {
                return res.status(403).json({
                    message: 'Можно удалять только свои комментарии',
                });
            }

            const actorName = await getActorName(userId);

            await prisma.$transaction(async (tx) => {
                await tx.cardActivity.create({
                    data: {
                        boardId,
                        cardId,
                        actorId: userId,
                        actorName,
                        type: 'COMMENT_DELETED',
                        details: {
                            commentId,
                            content: comment.content,
                        },
                    },
                });

                await tx.comment.delete({
                    where: {id: commentId},
                });
            });

            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'card',
                entityId: cardId,
                actorId: userId,
            });

            return res.json({
                message: 'Комментарий удалён',
            });
        } catch (error) {
            console.error('Failed to delete comment:', error);

            return res.status(500).json({
                message: 'Не удалось удалить комментарий',
            });
        }
    },
);

export default cardActivityRouter;
