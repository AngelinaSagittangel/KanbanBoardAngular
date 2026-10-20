import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {URL} from 'node:url';
import WebSocket, {WebSocketServer} from 'ws';
import {prisma} from '../lib/prisma.js';

type Ticket = {
    userId: string;
    expiresAt: number;
};

type Client = {
    socket: WebSocket;
    userId: string;
    boardId: string | null;
};

type DeletedBoardEvent = {
    boardId: string;
    boardTitle: string;
    ownerId: string;
    memberIds: string[];
};

type NotificationEvent = {
    id: string;
    recipientId: string;
    type:
        | 'CARD_ASSIGNED'
        | 'CARD_UNASSIGNED'
        | 'BOARD_MEMBER_REMOVED'
        | 'BOARD_MEMBER_LEFT';
    actorName: string;
    boardId: string;
    boardTitle: string;
    cardId: string | null;
    cardTitle: string | null;
    message: string;
    readAt: Date | null;
    createdAt: Date;
};
type BoardChangeEvent = {
    boardId: string;
    action: 'created' | 'updated' | 'deleted' | 'moved';
    entity: 'board' | 'column' | 'card';
    entityId?: string;
    actorId: string;
};

type EditingLock = {
    boardId: string;
    cardId: string;
    userId: string;
    client: Client;
};

const tickets = new Map<string, Ticket>();
const clients = new Set<Client>();

const editingLocks = new Map<string, EditingLock>();

function getEditingLockKey(boardId: string, cardId: string): string {
    return `${boardId}:${cardId}`;
}

function sendToClient(
    client: Client,
    message: Record<string, unknown>,
): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        client.socket.send(JSON.stringify(message));
    } catch (error) {
        console.error('Failed to send WebSocket message:', error);
    }
}

function broadcastToBoard(
    boardId: string,
    message: Record<string, unknown>,
): void {
    for (const client of clients) {
        if (client.boardId === boardId) {
            sendToClient(client, message);
        }
    }
}

function broadcastEditingEnded(lock: EditingLock): void {
    broadcastToBoard(lock.boardId, {
        type: 'card:edit:ended',
        payload: {
            boardId: lock.boardId,
            cardId: lock.cardId,
            userId: lock.userId,
        },
    });
}

function clearEditingLock(lockKey: string, lock: EditingLock): void {
    if (editingLocks.get(lockKey) !== lock) {
        return;
    }

    editingLocks.delete(lockKey);
    broadcastEditingEnded(lock);
}

function clearClientEditingLocks(client: Client): void {
    for (const [lockKey, lock] of editingLocks) {
        if (lock.client === client) {
            clearEditingLock(lockKey, lock);
        }
    }
}

function clearBoardEditingLocks(boardId: string): void {
    for (const [lockKey, lock] of editingLocks) {
        if (lock.boardId === boardId) {
            clearEditingLock(lockKey, lock);
        }
    }
}

function startCardEditing(
    client: Client,
    boardId: string,
    cardId: string,
): void {
    if (client.boardId !== boardId) {
        return;
    }

    const lockKey = getEditingLockKey(boardId, cardId);
    const existingLock = editingLocks.get(lockKey);

    if (existingLock && existingLock.userId !== client.userId) {
        sendToClient(client, {
            type: 'card:edit:conflict',
            payload: {
                boardId,
                cardId,
                userId: existingLock.userId,
            },
        });

        return;
    }

    const lock: EditingLock = {
        boardId,
        cardId,
        userId: client.userId,
        client,
    };

    editingLocks.set(lockKey, lock);

    broadcastToBoard(boardId, {
        type: 'card:editing',
        payload: {
            boardId,
            cardId,
            userId: client.userId,
        },
    });
}

function stopCardEditing(
    client: Client,
    boardId: string,
    cardId: string,
): void {
    const lockKey = getEditingLockKey(boardId, cardId);
    const lock = editingLocks.get(lockKey);

    if (!lock || lock.client !== client) {
        return;
    }

    clearEditingLock(lockKey, lock);
}

export function issueWebSocketTicket(userId: string): string {
    const ticket = randomUUID();

    tickets.set(ticket, {
        userId,
        expiresAt: Date.now() + 30_000,
    });

    return ticket;
}

/**
 * Рассылает изменение всем участникам, подписанным на доску.
 * Вызывать только после успешного сохранения изменений в БД.
 */
export function broadcastBoardChange(
    boardId: string,
    event: Omit<BoardChangeEvent, 'boardId'>,
): void {
    const payload: BoardChangeEvent = {
        boardId,
        ...event,
    };

    broadcastToBoard(boardId, {
        type: 'board:changed',
        payload,
    });
}

export function notifyUser(
    userId: string,
    notification: NotificationEvent,
): void {
    for (const client of clients) {
        if (client.userId !== userId) {
            continue;
        }

        sendToClient(client, {
            type: 'notification:new',
            payload: notification,
        });
    }
}

export function notifyBoardDeleted(event: DeletedBoardEvent): void {
    const allowedUsers = new Set([
        event.ownerId,
        ...event.memberIds,
    ]);

    clearBoardEditingLocks(event.boardId);

    for (const client of clients) {
        if (
            client.boardId !== event.boardId ||
            !allowedUsers.has(client.userId)
        ) {
            continue;
        }

        sendToClient(client, {
            type: 'board:deleted',
            payload: {
                boardId: event.boardId,
                boardTitle: event.boardTitle,
                ownerId: event.ownerId,
            },
        });

        client.boardId = null;
    }
}

export function notifyBoardAccessRevoked(
    boardId: string,
    userId: string,
    boardTitle: string,
    reason: 'removed' | 'left',
): void {
    for (const client of clients) {
        if (client.userId !== userId) {
            continue;
        }

        if (client.boardId === boardId) {
            clearClientEditingLocks(client);
            client.boardId = null;
        }

        sendToClient(client, {
            type: 'board:access-revoked',
            payload: {
                boardId,
                boardTitle,
                reason,
            },
        });
    }
}

export function notifyInvitationsChanged(userId: string): void {
    for (const client of clients) {
        if (client.userId !== userId) {
            continue;
        }

        sendToClient(client, {
            type: 'invitations:changed',
        });
    }
}

export function attachRealtimeServer(server: Server): void {
    const wss = new WebSocketServer({
        server,
        path: '/ws',
    });

    wss.on('connection', (socket, request) => {
        const requestUrl = new URL(
            request.url ?? '/',
            'http://localhost',
        );

        const ticket = requestUrl.searchParams.get('ticket');

        if (!ticket) {
            socket.close(1008, 'Missing ticket');
            return;
        }

        const ticketData = tickets.get(ticket);

        if (!ticketData || ticketData.expiresAt < Date.now()) {
            tickets.delete(ticket);
            socket.close(1008, 'Invalid or expired ticket');
            return;
        }

        tickets.delete(ticket);

        const client: Client = {
            socket,
            userId: ticketData.userId,
            boardId: null,
        };

        clients.add(client);

        socket.on('message', async (rawMessage) => {
            try {
                const message = JSON.parse(rawMessage.toString()) as {
                    type?: string;
                    boardId?: string;
                    cardId?: string;
                };

                if (
                    message.type === 'board:unsubscribe' &&
                    typeof message.boardId === 'string'
                ) {
                    if (client.boardId === message.boardId) {
                        clearClientEditingLocks(client);
                        client.boardId = null;
                    }

                    return;
                }

                if (
                    (message.type === 'card:edit:start' ||
                        message.type === 'card:edit:stop') &&
                    typeof message.boardId === 'string' &&
                    typeof message.cardId === 'string'
                ) {
                    if (message.type === 'card:edit:start') {
                        startCardEditing(client, message.boardId, message.cardId);
                    } else {
                        stopCardEditing(client, message.boardId, message.cardId);
                    }

                    return;
                }

                if (
                    message.type !== 'board:subscribe' ||
                    typeof message.boardId !== 'string'
                ) {
                    return;
                }

                const board = await prisma.board.findFirst({
                    where: {
                        id: message.boardId,
                        OR: [
                            {ownerId: client.userId},
                            {
                                members: {
                                    some: {
                                        userId: client.userId,
                                    },
                                },
                            },
                        ],
                    },
                    select: {
                        id: true,
                    },
                });

                if (!board) {
                    sendToClient(client, {
                        type: 'board:unavailable',
                        payload: {
                            boardId: message.boardId,
                        },
                    });

                    return;
                }

                if (client.boardId && client.boardId !== board.id) {
                    clearClientEditingLocks(client);
                }

                client.boardId = board.id;

                sendToClient(client, {
                    type: 'board:subscribed',
                    payload: {
                        boardId: board.id,
                    },
                });
            } catch (error) {
                console.error(
                    'Failed to process WebSocket message:',
                    error,
                );
            }
        });

        socket.on('close', () => {
            clearClientEditingLocks(client);
            clients.delete(client);
        });

        socket.on('error', (error) => {
            console.error('WebSocket error:', error);
            clearClientEditingLocks(client);
            clients.delete(client);
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
    });
}
