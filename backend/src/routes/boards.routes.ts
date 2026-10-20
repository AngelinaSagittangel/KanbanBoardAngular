import {Router} from 'express';
import {z} from 'zod';
import {Prisma} from '../generated/prisma/client.js';
import {prisma} from '../lib/prisma.js';
import {recordCardActivity} from '../lib/card-activity.js';
import {
    authMiddleware,
    type AuthRequest,
} from '../middleware/auth.middleware.js';
import {
    broadcastBoardChange, notifyBoardAccessRevoked,
    notifyBoardDeleted,
    notifyUser,
} from '../realtime/realtime.js';

const boardsRouter = Router();

const createBoardSchema = z.object({
    title: z.string().trim().min(1, 'Название обязательно').max(100),
    description: z.string().trim().max(500).optional().nullable(),
});

const checklistItemSchema = z.object({
    id: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(200),
    completed: z.boolean(),
});

const checklistSchema = z.array(checklistItemSchema).max(100);

const createCardSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    labelColor: z.string().max(50).nullable().optional(),
    checklist: checklistSchema.nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
});

const updateBoardSchema = z
    .object({
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(500).nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'Укажи хотя бы одно поле для изменения',
    });

const updateCardSchema = z
    .object({
        expectedUpdatedAt: z.string().datetime(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        completed: z.boolean().optional(),
        dueDate: z.string().datetime().nullable().optional(),
        label: z.string().max(100).nullable().optional(),
        labelColor: z.string().max(50).nullable().optional(),
        checklist: checklistSchema.nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
    })
    .refine(
        (data) =>
            Object.keys(data).some((key) => key !== 'expectedUpdatedAt'),
        {
            message: 'Укажи хотя бы одно поле для изменения',
        },
    );

const createColumnSchema = z.object({
    title: z.string().trim().min(1, 'Название обязательно').max(100),
});

const updateColumnSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, 'Название обязательно')
            .max(100)
            .optional(),
        color: z.enum([
            'blue',
            'purple',
            'green',
            'yellow',
            'pink',
            'orange',
            'teal',
            'gray',
        ]).optional(),
        note: z.string().max(300).nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'Укажи хотя бы одно поле для изменения',
    });

const moveCardSchema = z.object({
    columnId: z.string().min(1),
    order: z.number().int().min(0),
});

boardsRouter.use(authMiddleware);
boardsRouter.get('/', async (req: AuthRequest, res) => {
    try {
        const userId = req.userId!;

        const boards = await prisma.board.findMany({
            where: {
                OR: [
                    {ownerId: userId},
                    {members: {some: {userId}}},
                ],
            },
            orderBy: {
                updatedAt: 'desc',
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        return res.json({boards});
    } catch (error) {
        console.error('Failed to get boards:', error);

        return res.status(500).json({
            message: 'Не удалось загрузить доски',
        });
    }
});

boardsRouter.post('/', async (req: AuthRequest, res) => {
    const validation = createBoardSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Некорректные данные доски',
            errors: validation.error.issues,
        });
    }

    try {
        const board = await prisma.board.create({
            data: {
                title: validation.data.title,
                description: validation.data.description ?? null,
                ownerId: req.userId!,
            },
        });

        return res.status(201).json({
            message: 'Доска создана',
            board,
        });
    } catch (error) {
        console.error('Failed to create board:', error);

        return res.status(500).json({
            message: 'Не удалось создать доску',
        });
    }
});

boardsRouter.get('/search', async (req: AuthRequest, res) => {
    const querySchema = z.object({
        q: z.string().trim().min(1).max(200),
        currentBoardId: z.string().optional(),
    });

    const validation = querySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Укажи поисковый запрос',
        });
    }

    try {
        const {q, currentBoardId} = validation.data;
        const userId = req.userId!;

        const cards = await prisma.card.findMany({
            where: {
                column: {
                    board: {
                        OR: [
                            {ownerId: userId},
                            {members: {some: {userId}}},
                        ],
                    },
                },
                OR: [
                    {
                        title: {
                            contains: q,
                            mode: 'insensitive',
                        },
                    },
                    {
                        description: {
                            contains: q,
                            mode: 'insensitive',
                        },
                    },
                ],
            },
            select: {
                id: true,
                title: true,
                description: true,
                completed: true,
                column: {
                    select: {
                        id: true,
                        title: true,
                        board: {
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                    },
                },
            },
            take: 100,
        });

        const results = cards
            .map((card) => ({
                boardId: card.column.board.id,
                boardTitle: card.column.board.title,
                columnId: card.column.id,
                columnTitle: card.column.title,
                cardId: card.id,
                cardTitle: card.title,
                cardDescription: card.description ?? '',
                completed: card.completed,
            }))
            .sort((a, b) => {
                const aIsCurrent = a.boardId === currentBoardId;
                const bIsCurrent = b.boardId === currentBoardId;

                if (aIsCurrent !== bIsCurrent) {
                    return aIsCurrent ? -1 : 1;
                }

                return a.cardTitle.localeCompare(b.cardTitle, 'ru');
            });

        return res.json({results});
    } catch (error) {
        console.error('Failed to search cards:', error);

        return res.status(500).json({
            message: 'Не удалось выполнить поиск',
        });
    }
});

boardsRouter.post('/:boardId/columns', async (req: AuthRequest, res) => {
    const validation = createColumnSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Некорректное название колонки',
            errors: validation.error.issues,
        });
    }

    try {
        const boardId = String(req.params.boardId);
        const userId = req.userId!;

        const board = await prisma.board.findFirst({
            where: {
                id: boardId,
                OR: [
                    {ownerId: userId},
                    {members: {some: {userId}}},
                ],
            },
            include: {
                columns: {
                    select: {order: true},
                    orderBy: {order: 'desc'},
                    take: 1,
                },
            },
        });

        if (!board) {
            return res.status(404).json({
                message: 'Доска не найдена',
            });
        }

        const nextOrder = board.columns.length > 0
            ? board.columns[0].order + 1
            : 0;

        const column = await prisma.column.create({
            data: {
                title: validation.data.title,
                order: nextOrder,
                boardId,
            },
            include: {
                cards: true,
            },
        });

        broadcastBoardChange(boardId, {
            action: 'created',
            entity: 'column',
            entityId: column.id,
            actorId: userId,
        });

        return res.status(201).json({
            message: 'Колонка создана',
            column,
        });
    } catch (error) {
        console.error('Failed to create column:', error);

        return res.status(500).json({
            message: 'Не удалось создать колонку',
        });
    }
});

boardsRouter.patch(
    '/:boardId/columns/:columnId',
    async (req: AuthRequest, res) => {
        const validation = updateColumnSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Некорректные данные колонки',
                errors: validation.error.issues,
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const columnId = String(req.params.columnId);
            const userId = req.userId!;

            const existingColumn = await prisma.column.findFirst({
                where: {
                    id: columnId,
                    boardId,
                    board: {
                        OR: [
                            {ownerId: userId},
                            {members: {some: {userId}}},
                        ],
                    },
                },
            });

            if (!existingColumn) {
                return res.status(404).json({
                    message: 'Колонка не найдена',
                });
            }

            const column = await prisma.column.update({
                where: {id: columnId},
                data: validation.data,
            });

            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'column',
                entityId: column.id,
                actorId: userId,
            });

            return res.json({
                message: 'Колонка обновлена',
                column,
            });
        } catch (error) {
            console.error('Failed to update column:', error);

            return res.status(500).json({
                message: 'Не удалось обновить колонку',
            });
        }
    },
);

boardsRouter.delete(
    '/:boardId/columns/:columnId',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const columnId = String(req.params.columnId);
            const userId = req.userId!;

            const existingColumn = await prisma.column.findFirst({
                where: {
                    id: columnId,
                    boardId,
                    board: {
                        OR: [
                            {ownerId: userId},
                            {members: {some: {userId}}},
                        ],
                    },
                },
            });

            if (!existingColumn) {
                return res.status(404).json({
                    message: 'Колонка не найдена',
                });
            }

            await prisma.$transaction(async (tx) => {
                await tx.column.delete({
                    where: {id: columnId},
                });

                const remainingColumns = await tx.column.findMany({
                    where: {boardId},
                    orderBy: [
                        {order: 'asc'},
                        {id: 'asc'},
                    ],
                    select: {id: true},
                });

                for (let i = 0; i < remainingColumns.length; i++) {
                    await tx.column.update({
                        where: {id: remainingColumns[i].id},
                        data: {order: -(i + 1)},
                    });
                }

                for (let i = 0; i < remainingColumns.length; i++) {
                    await tx.column.update({
                        where: {id: remainingColumns[i].id},
                        data: {order: i},
                    });
                }
            });

            broadcastBoardChange(boardId, {
                action: 'deleted',
                entity: 'column',
                entityId: columnId,
                actorId: userId,
            });

            return res.json({
                message: 'Колонка удалена',
            });
        } catch (error) {
            console.error('Failed to delete column:', error);

            return res.status(500).json({
                message: 'Не удалось удалить колонку',
            });
        }
    },
);

boardsRouter.post(
    '/:boardId/columns/:columnId/cards',
    async (req: AuthRequest, res) => {
        const validation = createCardSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Некорректные данные карточки',
                errors: validation.error.issues,
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const columnId = String(req.params.columnId);
            const userId = req.userId!;

            const column = await prisma.column.findFirst({
                where: {
                    id: columnId,
                    boardId,
                    board: {
                        OR: [
                            {ownerId: userId},
                            {members: {some: {userId}}},
                        ],
                    },
                },
                include: {
                    board: {
                        select: {
                            id: true,
                            title: true,
                            ownerId: true,
                        },
                    },
                    cards: {
                        select: {order: true},
                        orderBy: {order: 'desc'},
                        take: 1,
                    },
                },
            });

            if (!column) {
                return res.status(404).json({
                    message: 'Колонка не найдена',
                });
            }

            const {assigneeId, ...cardData} = validation.data;

            if (assigneeId != null) {
                if (column.board.ownerId !== userId) {
                    return res.status(403).json({
                        message:
                            'Только владелец доски может назначать исполнителя',
                    });
                }

                const eligibleUser = await prisma.user.findFirst({
                    where: {
                        id: assigneeId,
                        OR: [
                            {
                                ownedBoards: {
                                    some: {id: boardId},
                                },
                            },
                            {
                                memberships: {
                                    some: {boardId},
                                },
                            },
                        ],
                    },
                    select: {id: true},
                });

                if (!eligibleUser) {
                    return res.status(400).json({
                        message:
                            'Исполнитель должен иметь доступ к доске',
                    });
                }
            }

            const nextOrder = column.cards.length > 0
                ? column.cards[0].order + 1
                : 0;

            const actor = await prisma.user.findUnique({
                where: {id: userId},
                select: {name: true},
            });

            const result = await prisma.$transaction(async (tx) => {
                const card = await tx.card.create({
                    data: {
                        title: cardData.title,
                        description: cardData.description ?? null,
                        dueDate: cardData.dueDate
                            ? new Date(cardData.dueDate)
                            : null,
                        label: cardData.label ?? null,
                        labelColor: cardData.labelColor ?? null,
                        checklist: cardData.checklist ?? [],
                        order: nextOrder,
                        columnId,
                        assigneeId: assigneeId ?? null,
                    },
                    include: {
                        assignee: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });

                let notification = null;

                if (assigneeId && assigneeId !== userId) {
                    const actorName = actor?.name ?? 'Пользователь';

                    notification = await tx.notification.create({
                        data: {
                            recipientId: assigneeId,
                            type: 'CARD_ASSIGNED',
                            actorName,
                            boardId,
                            boardTitle: column.board.title,
                            cardId: card.id,
                            cardTitle: card.title,
                            message:
                                `${actorName} назначил вас исполнителем карточки «${card.title}»`,
                        },
                    });
                }

                return {card, notification};
            });

            if (result.notification) {
                notifyUser(
                    result.notification.recipientId,
                    result.notification,
                );
            }

            await recordCardActivity({
                boardId,
                cardId: result.card.id,
                actorId: userId,
                type: 'CARD_CREATED',
                details: {
                    title: result.card.title,
                    columnId,
                    columnTitle: column.title,
                },
            });

            if (assigneeId) {
                await recordCardActivity({
                    boardId,
                    cardId: result.card.id,
                    actorId: userId,
                    type: 'CARD_ASSIGNED',
                    details: {
                        title: result.card.title,
                        assigneeId,
                        assigneeName: result.card.assignee?.name ?? '',
                    },
                });
            }

            broadcastBoardChange(boardId, {
                action: 'created',
                entity: 'card',
                entityId: result.card.id,
                actorId: userId,
            });

            return res.status(201).json({
                message: 'Карточка создана',
                card: result.card,
            });
        } catch (error) {
            console.error('Failed to create card:', error);

            return res.status(500).json({
                message: 'Не удалось создать карточку',
            });
        }
    },
);

boardsRouter.patch(
    '/:boardId/columns/:columnId/cards/:cardId',
    async (req: AuthRequest, res) => {
        const validation = updateCardSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Некорректные данные карточки',
                errors: validation.error.issues,
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const columnId = String(req.params.columnId);
            const cardId = String(req.params.cardId);
            const userId = req.userId!;

            const existingCard = await prisma.card.findFirst({
                include: {
                    assignee: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
                where: {
                    id: cardId,
                    columnId,
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
            });

            if (!existingCard) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const previousCard = {
                title: existingCard.title,
                description: existingCard.description,
                completed: existingCard.completed,
                dueDate: existingCard.dueDate?.toISOString() ?? null,
                label: existingCard.label,
                labelColor: existingCard.labelColor,
                checklist: existingCard.checklist,
                assigneeId: existingCard.assigneeId,
                assigneeName: existingCard.assignee?.name ?? '',
            };

            const {
                expectedUpdatedAt,
                checklist,
                dueDate,
                assigneeId,
                ...cardData
            } = validation.data;

            if (assigneeId !== undefined) {
                const board = await prisma.board.findUnique({
                    where: {id: boardId},
                    select: {ownerId: true},
                });

                if (!board || board.ownerId !== userId) {
                    return res.status(403).json({
                        message: 'Только владелец доски может назначать исполнителя',
                    });
                }

                if (assigneeId !== null) {
                    const eligibleUser = await prisma.user.findFirst({
                        where: {
                            id: assigneeId,
                            OR: [
                                {
                                    ownedBoards: {
                                        some: {id: boardId},
                                    },
                                },
                                {
                                    memberships: {
                                        some: {boardId},
                                    },
                                },
                            ],
                        },
                        select: {id: true},
                    });

                    if (!eligibleUser) {
                        return res.status(400).json({
                            message: 'Исполнитель должен иметь доступ к доске',
                        });
                    }
                }
            }

            const updateResult = await prisma.card.updateMany({
                where: {
                    id: cardId,
                    columnId,
                    updatedAt: new Date(expectedUpdatedAt),
                },
                data: {
                    ...cardData,

                    ...(dueDate !== undefined && {
                        dueDate: dueDate
                            ? new Date(dueDate)
                            : null,
                    }),

                    ...(checklist !== undefined && {
                        checklist:
                            checklist === null
                                ? Prisma.DbNull
                                : checklist,
                    }),

                    ...(assigneeId !== undefined && {
                        assigneeId,
                    }),
                },
            });

            if (updateResult.count === 0) {
                return res.status(409).json({
                    message:
                        'Карточка уже изменена другим участником. Обнови данные перед сохранением.',
                    code: 'CARD_EDIT_CONFLICT',
                });
            }

            const card = await prisma.card.findUnique({
                where: {id: cardId},
                include: {
                    assignee: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            if (card.assigneeId !== previousCard.assigneeId) {
                await recordCardActivity({
                    boardId,
                    cardId,
                    actorId: userId,
                    type: card.assigneeId ? 'CARD_ASSIGNED' : 'CARD_UNASSIGNED',
                    details: {
                        title: card.title,
                        assigneeId: card.assigneeId,
                        assigneeName: card.assigneeId
                            ? card.assignee?.name ?? ''
                            : previousCard.assigneeName,
                    },
                });

                if (card.assigneeId && card.assigneeId !== userId) {
                    const actor = await prisma.user.findUnique({
                        where: {id: userId},
                        select: {name: true},
                    });

                    const board = await prisma.board.findUnique({
                        where: {id: boardId},
                        select: {title: true},
                    });

                    if (board) {
                        const notification = await prisma.notification.create({
                            data: {
                                recipientId: card.assigneeId,
                                type: 'CARD_ASSIGNED',
                                actorName: actor?.name ?? 'Пользователь',
                                boardId,
                                boardTitle: board.title,
                                cardId: card.id,
                                cardTitle: card.title,
                                message:
                                    `${actor?.name ?? 'Пользователь'} назначил вас исполнителем карточки «${card.title}»`,
                            },
                        });

                        notifyUser(notification.recipientId, notification);
                    }
                }
            }

            const changes: Record<
                string,
                { old: unknown; new: unknown }
            > = {};

            if (card.title !== previousCard.title) {
                changes.title = {
                    old: previousCard.title,
                    new: card.title,
                };
            }

            if (card.description !== previousCard.description) {
                changes.description = {
                    old: previousCard.description,
                    new: card.description,
                };
            }

            const currentDueDate = card.dueDate?.toISOString() ?? null;

            if (currentDueDate !== previousCard.dueDate) {
                changes.dueDate = {
                    old: previousCard.dueDate,
                    new: currentDueDate,
                };
            }

            if (card.label !== previousCard.label) {
                changes.label = {
                    old: previousCard.label,
                    new: card.label,
                };
            }

            if (card.labelColor !== previousCard.labelColor) {
                changes.labelColor = {
                    old: previousCard.labelColor,
                    new: card.labelColor,
                };
            }

            if (
                JSON.stringify(card.checklist) !==
                JSON.stringify(previousCard.checklist)
            ) {
                changes.checklist = {
                    old: previousCard.checklist,
                    new: card.checklist,
                };
            }

            if (card.completed !== previousCard.completed) {
                await recordCardActivity({
                    boardId,
                    cardId,
                    actorId: userId,
                    type: 'CARD_COMPLETED',
                    details: {
                        title: card.title,
                        completed: card.completed,
                    },
                });
            }

            if (changes.checklist) {
                await recordCardActivity({
                    boardId,
                    cardId,
                    actorId: userId,
                    type: 'CHECKLIST_UPDATED',
                    details: {
                        title: card.title,
                        changes: {
                            checklist: changes.checklist,
                        },
                    } as Prisma.InputJsonObject,
                });

                delete changes.checklist;
            }


            for (const [field, change] of Object.entries(changes)) {
                await recordCardActivity({
                    boardId,
                    cardId,
                    actorId: userId,
                    type: 'CARD_UPDATED',
                    details: {
                        title: card.title,
                        field,
                        oldValue: change.old === undefined ? null : change.old,
                        newValue: change.new === undefined ? null : change.new,
                    } as Prisma.InputJsonObject,
                });
            }


            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'card',
                entityId: card.id,
                actorId: userId,
            });

            return res.json({
                message: 'Карточка обновлена',
                card,
            });
        } catch (error) {
            console.error('Failed to update card:', error);

            return res.status(500).json({
                message: 'Не удалось обновить карточку',
            });
        }
    },
);

boardsRouter.delete(
    '/:boardId/columns/:columnId/cards/:cardId',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const columnId = String(req.params.columnId);
            const cardId = String(req.params.cardId);
            const userId = req.userId!;

            const card = await prisma.card.findFirst({
                where: {
                    id: cardId,
                    columnId,
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
                include: {
                    column: {
                        select: {
                            title: true,
                        },
                    },
                },
            });

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            await recordCardActivity({
                boardId,
                cardId,
                actorId: userId,
                type: 'CARD_DELETED',
                details: {
                    title: card.title,
                    columnId,
                    columnTitle: card.column.title,
                },
            });

            await prisma.card.delete({
                where: {id: cardId},
            });

            broadcastBoardChange(boardId, {
                action: 'deleted',
                entity: 'card',
                entityId: cardId,
                actorId: userId,
            });

            return res.json({
                message: 'Карточка удалена',
            });
        } catch (error) {
            console.error('Failed to delete card:', error);

            return res.status(500).json({
                message: 'Не удалось удалить карточку',
            });
        }
    },
);

boardsRouter.get('/:boardId', async (req: AuthRequest, res) => {
    try {
        const boardId = String(req.params.boardId);
        const userId = req.userId!;

        const board = await prisma.board.findFirst({
            where: {
                id: boardId,
                OR: [
                    {ownerId: userId},
                    {members: {some: {userId}}},
                ],
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                members: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                    orderBy: {
                        joinedAt: 'asc',
                    },
                },
                columns: {
                    orderBy: {order: 'asc'},
                    include: {
                        cards: {
                            orderBy: {order: 'asc'},
                            include: {
                                assignee: {
                                    select: {
                                        id: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!board) {
            return res.status(404).json({
                message: 'Доска не найдена',
            });
        }

        return res.json({board});
    } catch (error) {
        console.error('Failed to get board:', error);

        return res.status(500).json({
            message: 'Не удалось загрузить доску',
        });
    }
});

boardsRouter.patch('/:boardId', async (req: AuthRequest, res) => {
    const validation = updateBoardSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Некорректные данные доски',
            errors: validation.error.issues,
        });
    }

    try {
        const boardId = String(req.params.boardId);
        const userId = req.userId!;

        const existingBoard = await prisma.board.findFirst({
            where: {
                id: boardId,
                ownerId: userId,
            },
        });

        if (!existingBoard) {
            return res.status(404).json({
                message: 'Доска не найдена',
            });
        }

        const board = await prisma.board.update({
            where: {id: boardId},
            data: validation.data,
        });

        broadcastBoardChange(boardId, {
            action: 'updated',
            entity: 'board',
            entityId: board.id,
            actorId: userId,
        });

        return res.json({
            message: 'Доска обновлена',
            board,
        });
    } catch (error) {
        console.error('Failed to update board:', error);

        return res.status(500).json({
            message: 'Не удалось обновить доску',
        });
    }
});

boardsRouter.patch(
    '/:boardId/cards/:cardId/move',
    async (req: AuthRequest, res) => {
        const validation = moveCardSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                message: 'Некорректные данные перемещения карточки',
                errors: validation.error.issues,
            });
        }

        try {
            const boardId = String(req.params.boardId);
            const cardId = String(req.params.cardId);
            const userId = req.userId!;
            const {columnId, order} = validation.data;

            const accessFilter = {
                OR: [
                    {ownerId: userId},
                    {members: {some: {userId}}},
                ],
            };

            const card = await prisma.card.findFirst({
                where: {
                    id: cardId,
                    column: {
                        boardId,
                        board: accessFilter,
                    },
                },
            });

            if (!card) {
                return res.status(404).json({
                    message: 'Карточка не найдена',
                });
            }

            const targetColumn = await prisma.column.findFirst({
                where: {
                    id: columnId,
                    boardId,
                    board: accessFilter,
                },
            });

            if (!targetColumn) {
                return res.status(404).json({
                    message: 'Целевая колонка не найдена',
                });
            }

            const sourceColumnId = card.columnId;

            const sourceColumn = await prisma.column.findUnique({
                where: {id: sourceColumnId},
                select: {
                    id: true,
                    title: true,
                },
            });

            if (!sourceColumn) {
                return res.status(404).json({
                    message: 'Исходная колонка не найдена',
                });
            }

            const movedCard = await prisma.$transaction(async (tx) => {
                const sourceCards = await tx.card.findMany({
                    where: {
                        columnId: sourceColumnId,
                        id: {not: cardId},
                    },
                    orderBy: [
                        {order: 'asc'},
                        {id: 'asc'},
                    ],
                    select: {id: true},
                });

                if (sourceColumnId === columnId) {
                    const orderedIds = sourceCards.map((item) => item.id);
                    const insertAt = Math.min(order, orderedIds.length);

                    orderedIds.splice(insertAt, 0, cardId);

                    for (let i = 0; i < orderedIds.length; i++) {
                        await tx.card.update({
                            where: {id: orderedIds[i]},
                            data: {order: -(i + 1)},
                        });
                    }

                    for (let i = 0; i < orderedIds.length; i++) {
                        await tx.card.update({
                            where: {id: orderedIds[i]},
                            data: {order: i},
                        });
                    }
                } else {
                    const targetCards = await tx.card.findMany({
                        where: {columnId},
                        orderBy: [
                            {order: 'asc'},
                            {id: 'asc'},
                        ],
                        select: {id: true},
                    });

                    const targetIds = targetCards.map((item) => item.id);
                    const insertAt = Math.min(order, targetIds.length);

                    targetIds.splice(insertAt, 0, cardId);

                    for (let i = 0; i < sourceCards.length; i++) {
                        await tx.card.update({
                            where: {id: sourceCards[i].id},
                            data: {order: -(i + 1)},
                        });
                    }

                    for (let i = 0; i < targetIds.length; i++) {
                        await tx.card.update({
                            where: {id: targetIds[i]},
                            data: {
                                columnId,
                                order: -(i + 1),
                            },
                        });
                    }

                    for (let i = 0; i < sourceCards.length; i++) {
                        await tx.card.update({
                            where: {id: sourceCards[i].id},
                            data: {order: i},
                        });
                    }

                    for (let i = 0; i < targetIds.length; i++) {
                        await tx.card.update({
                            where: {id: targetIds[i]},
                            data: {order: i},
                        });
                    }
                }

                return tx.card.findUniqueOrThrow({
                    where: {id: cardId},
                });
            });

            if (sourceColumnId !== columnId) {
                await recordCardActivity({
                    boardId,
                    cardId,
                    actorId: userId,
                    type: 'CARD_MOVED',
                    details: {
                        title: card.title,
                        fromColumnId: sourceColumn.id,
                        fromColumnTitle: sourceColumn.title,
                        toColumnId: targetColumn.id,
                        toColumnTitle: targetColumn.title,
                    },
                });
            }

            broadcastBoardChange(boardId, {
                action: 'moved',
                entity: 'card',
                entityId: movedCard.id,
                actorId: userId,
            });

            return res.json({
                message: 'Карточка перемещена',
                card: movedCard,
            });
        } catch (error) {
            console.error('Failed to move card:', error);

            return res.status(500).json({
                message: 'Не удалось переместить карточку',
            });
        }
    },
);

boardsRouter.delete('/:boardId', async (req: AuthRequest, res) => {
    try {
        const boardId = String(req.params.boardId);
        const userId = req.userId!;

        const existingBoard = await prisma.board.findFirst({
            where: {
                id: boardId,
                ownerId: userId,
            },
            include: {
                members: {
                    select: {userId: true},
                },
            },
        });

        if (!existingBoard) {
            return res.status(404).json({
                message: 'Доска не найдена',
            });
        }

        await prisma.board.delete({
            where: {id: boardId},
        });

        notifyBoardDeleted({
            boardId: existingBoard.id,
            boardTitle: existingBoard.title,
            ownerId: existingBoard.ownerId,
            memberIds: existingBoard.members.map(
                (member) => member.userId,
            ),
        });

        return res.json({
            message: 'Доска удалена',
        });
    } catch (error) {
        console.error('Failed to delete board:', error);

        return res.status(500).json({
            message: 'Не удалось удалить доску',
        });
    }
});

boardsRouter.delete(
    '/:boardId/members/:memberUserId',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const memberUserId = String(req.params.memberUserId);
            const userId = req.userId!;

            const board = await prisma.board.findUnique({
                where: { id: boardId },
                include: {
                    owner: {
                        select: { id: true, name: true },
                    },
                },
            });

            if (!board) {
                return res.status(404).json({
                    message: 'Доска не найдена',
                });
            }

            if (board.ownerId !== userId) {
                return res.status(403).json({
                    message: 'Удалять участников может только владелец доски',
                });
            }

            if (memberUserId === board.ownerId) {
                return res.status(400).json({
                    message: 'Нельзя удалить владельца доски',
                });
            }

            const member = await prisma.boardMember.findFirst({
                where: {
                    boardId,
                    userId: memberUserId,
                },
                include: {
                    user: {
                        select: { name: true },
                    },
                },
            });

            if (!member) {
                return res.status(404).json({
                    message: 'Участник не найден',
                });
            }

            const notification = await prisma.$transaction(async (tx) => {
                const deleted = await tx.boardMember.deleteMany({
                    where: {
                        boardId,
                        userId: memberUserId,
                    },
                });

                if (deleted.count === 0) {
                    return null;
                }

                return tx.notification.create({
                    data: {
                        recipientId: memberUserId,
                        type: 'BOARD_MEMBER_REMOVED',
                        actorName: board.owner.name,
                        boardId,
                        boardTitle: board.title,
                        cardId: null,
                        cardTitle: null,
                        message:
                            `Владелец удалил вас из доски «${board.title}»`,
                    },
                });
            });

            if (!notification) {
                return res.status(409).json({
                    message: 'Участник уже не состоит в доске',
                });
            }

            notifyUser(memberUserId, notification);

            notifyBoardAccessRevoked(
                boardId,
                memberUserId,
                board.title,
                'removed',
            );

            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'board',
                actorId: userId,
            });

            return res.json({
                message: 'Участник удалён с доски',
            });
        } catch (error) {
            console.error('Failed to remove board member:', error);

            return res.status(500).json({
                message: 'Не удалось удалить участника',
            });
        }
    },
);

boardsRouter.delete(
    '/:boardId/leave',
    async (req: AuthRequest, res) => {
        try {
            const boardId = String(req.params.boardId);
            const userId = req.userId!;

            const board = await prisma.board.findUnique({
                where: { id: boardId },
                include: {
                    owner: {
                        select: { id: true, name: true },
                    },
                },
            });

            if (!board) {
                return res.status(404).json({
                    message: 'Доска не найдена',
                });
            }

            if (board.ownerId === userId) {
                return res.status(400).json({
                    message: 'Владелец не может покинуть собственную доску',
                });
            }

            const actor = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true },
            });

            if (!actor) {
                return res.status(404).json({
                    message: 'Пользователь не найден',
                });
            }

            const notification = await prisma.$transaction(async (tx) => {
                const deleted = await tx.boardMember.deleteMany({
                    where: {
                        boardId,
                        userId,
                    },
                });

                if (deleted.count === 0) {
                    return null;
                }

                return tx.notification.create({
                    data: {
                        recipientId: board.ownerId,
                        type: 'BOARD_MEMBER_LEFT',
                        actorName: actor.name,
                        boardId,
                        boardTitle: board.title,
                        cardId: null,
                        cardTitle: null,
                        message:
                            `${actor.name} покинул доску «${board.title}»`,
                    },
                });
            });

            if (!notification) {
                return res.status(409).json({
                    message: 'Вы уже не состоите в этой доске',
                });
            }

            notifyUser(board.ownerId, notification);

            notifyBoardAccessRevoked(
                boardId,
                userId,
                board.title,
                'left',
            );

            broadcastBoardChange(boardId, {
                action: 'updated',
                entity: 'board',
                actorId: userId,
            });

            return res.json({
                message: 'Вы покинули доску',
            });
        } catch (error) {
            console.error('Failed to leave board:', error);

            return res.status(500).json({
                message: 'Не удалось покинуть доску',
            });
        }
    },
);

export default boardsRouter;