import {Router} from 'express';
import {z} from 'zod';
import {prisma} from '../lib/prisma.js';
import {
    authMiddleware,
    type AuthRequest,
} from '../middleware/auth.middleware.js';
import {notifyInvitationsChanged} from "../realtime/realtime.js";

const invitationsRouter = Router();

invitationsRouter.use(authMiddleware);

const createInvitationSchema = z.object({
    email: z.string().trim().email('Укажи корректный email').max(254),
});

const invitationResponseSchema = z.object({
    action: z.enum(['accept', 'decline']),
});

invitationsRouter.post(
    '/boards/:boardId',
    async (req: AuthRequest, res) => {
        const validation = createInvitationSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Укажи корректный email',
                errors: validation.error.issues,
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const ownerId = req.userId!;
            const email = validation.data.email.toLowerCase();

            const board = await prisma.board.findFirst({
                where: {
                    id: boardId,
                    ownerId,
                },
                select: {
                    id: true,
                    title: true,
                },
            });

            if (!board) {
                return res.status(404).json({
                    message: 'Доска не найдена или у тебя нет прав владельца',
                });
            }

            const recipient = await prisma.user.findFirst({
                where: {
                    email: {
                        equals: email,
                        mode: 'insensitive',
                    },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            });

            if (!recipient) {
                return res.status(404).json({
                    message: 'Пользователь с таким email не зарегистрирован',
                });
            }

            if (recipient.id === ownerId) {
                return res.status(400).json({
                    message: 'Нельзя пригласить самого себя',
                });
            }

            const existingMember = await prisma.boardMember.findUnique({
                where: {
                    boardId_userId: {
                        boardId,
                        userId: recipient.id,
                    },
                },
            });

            if (existingMember) {
                return res.status(409).json({
                    message: 'Этот пользователь уже участвует в доске',
                });
            }

            const existingInvitation =
                await prisma.boardInvitation.findUnique({
                    where: {
                        boardId_recipientUserId: {
                            boardId,
                            recipientUserId: recipient.id,
                        },
                    },
                });

            if (existingInvitation?.status === 'PENDING') {
                return res.status(409).json({
                    message: 'Приглашение этому пользователю уже отправлено',
                });
            }


            const invitation = existingInvitation
                ? await prisma.boardInvitation.update({
                    where: {
                        id: existingInvitation.id,
                    },
                    data: {
                        email: recipient.email,
                        invitedById: ownerId,
                        status: 'PENDING',
                        createdAt: new Date(),
                        respondedAt: null,
                    },
                    include: {
                        board: {
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                        invitedBy: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                })
                : await prisma.boardInvitation.create({
                    data: {
                        boardId,
                        email: recipient.email,
                        invitedById: ownerId,
                        recipientUserId: recipient.id,
                    },
                    include: {
                        board: {
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                        invitedBy: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });

            notifyInvitationsChanged(recipient.id);

            return res.status(201).json({
                message: 'Приглашение отправлено',
                invitation,
            });
        } catch (error) {
            console.error('Failed to create invitation:', error);

            return res.status(500).json({
                message: 'Не удалось отправить приглашение',
            });
        }
    },
);

invitationsRouter.get('/', async (req: AuthRequest, res) => {
    try {
        const invitations = await prisma.boardInvitation.findMany({
            where: {
                recipientUserId: req.userId!,
                status: 'PENDING',
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                board: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                    },
                },
                invitedBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });

        return res.json({invitations});
    } catch (error) {
        console.error('Failed to get invitations:', error);

        return res.status(500).json({
            message: 'Не удалось загрузить приглашения',
        });
    }
});

invitationsRouter.patch(
    '/:invitationId/respond',
    async (req: AuthRequest, res) => {
        const validation = invitationResponseSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Неизвестное действие',
                errors: validation.error.issues,
            });
        }

        try {
            const invitationId = String(req.params.invitationId);
            const userId = req.userId!;
            const {action} = validation.data;

            const invitation = await prisma.boardInvitation.findFirst({
                where: {
                    id: invitationId,
                    recipientUserId: userId,
                },
            });

            if (!invitation) {
                return res.status(404).json({
                    message: 'Приглашение не найдено',
                });
            }

            if (invitation.status !== 'PENDING') {
                return res.status(409).json({
                    message: 'На это приглашение уже ответили',
                });
            }

            if (action === 'decline') {
                const updatedInvitation =
                    await prisma.boardInvitation.updateMany({
                        where: {
                            id: invitationId,
                            recipientUserId: userId,
                            status: 'PENDING',
                        },
                        data: {
                            status: 'DECLINED',
                            respondedAt: new Date(),
                        },
                    });

                if (updatedInvitation.count === 0) {
                    return res.status(409).json({
                        message: 'Приглашение уже обработано',
                    });
                }
                notifyInvitationsChanged(userId);
                return res.json({
                    message: 'Приглашение отклонено',
                });
            }

            const result = await prisma.$transaction(async (tx) => {
                const updatedInvitation =
                    await tx.boardInvitation.updateMany({
                        where: {
                            id: invitationId,
                            recipientUserId: userId,
                            status: 'PENDING',
                        },
                        data: {
                            status: 'ACCEPTED',
                            respondedAt: new Date(),
                        },
                    });

                if (updatedInvitation.count === 0) {
                    throw new Error('INVITATION_ALREADY_RESPONDED');
                }

                await tx.boardMember.upsert({
                    where: {
                        boardId_userId: {
                            boardId: invitation.boardId,
                            userId,
                        },
                    },
                    create: {
                        boardId: invitation.boardId,
                        userId,
                        role: 'MEMBER',
                    },
                    update: {},
                });

                return tx.boardInvitation.findUniqueOrThrow({
                    where: {
                        id: invitationId,
                    },
                    include: {
                        board: {
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                    },
                });
            });
            notifyInvitationsChanged(userId);
            return res.json({
                message: 'Приглашение принято',
                invitation: result,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'INVITATION_ALREADY_RESPONDED'
            ) {
                return res.status(409).json({
                    message: 'Приглашение уже обработано',
                });
            }

            console.error('Failed to respond to invitation:', error);

            return res.status(500).json({
                message: 'Не удалось обработать приглашение',
            });
        }
    },
);

export default invitationsRouter;
