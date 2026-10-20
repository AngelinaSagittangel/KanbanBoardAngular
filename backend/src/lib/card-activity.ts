import {prisma} from './prisma.js';
import type {CardActivityType, Prisma} from '../generated/prisma/client.js';

interface RecordCardActivityParams {
    boardId: string;
    cardId: string | null;
    actorId: string;
    type: CardActivityType;
    details?: Prisma.InputJsonValue;
}

export async function recordCardActivity({
                                             boardId,
                                             cardId,
                                             actorId,
                                             type,
                                             details,
                                         }: RecordCardActivityParams): Promise<void> {
    const actor = await prisma.user.findUnique({
        where: {id: actorId},
        select: {name: true},
    });

    await prisma.cardActivity.create({
        data: {
            boardId,
            cardId,
            actorId,
            actorName: actor?.name ?? 'Пользователь',
            type,
            ...(details !== undefined ? {details} : {}),
        },
    });
}
