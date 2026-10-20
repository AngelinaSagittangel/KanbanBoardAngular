import { inject, Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';

import { BoardService } from './board.service';

export interface BoardRealtimePayload {
  boardId?: string;
  boardTitle?: string;
  ownerId?: string;
  action?: 'created' | 'updated' | 'deleted' | 'moved';
  entity?: 'board' | 'column' | 'card';
  entityId?: string;
  actorId?: string;
  cardId?: string;
  userId?: string;
  reason?: 'removed' | 'left';
}

export interface BoardRealtimeMessage {
  type?: string;
  payload?: BoardRealtimePayload;
}

@Injectable({ providedIn: 'root' })
export class BoardRealtimeService implements OnDestroy {
  private readonly boardService = inject(BoardService);

  private socket: WebSocket | null = null;
  private ticketSubscription: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private shouldReconnect = false;
  private connectionAttempt = 0;

  private readonly messagesSubject = new Subject<BoardRealtimeMessage>();
  private readonly connectedSubject = new Subject<void>();

  readonly messages$: Observable<BoardRealtimeMessage> = this.messagesSubject.asObservable();

  readonly connected$: Observable<void> = this.connectedSubject.asObservable();

  connect(): void {
    if (this.shouldReconnect) {
      return;
    }

    this.shouldReconnect = true;
    this.openConnection();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.connectionAttempt++;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ticketSubscription?.unsubscribe();
    this.ticketSubscription = null;

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      // Не даём старому сокету запускать переподключение.
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
    }
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  subscribeToBoard(boardId: string): void {
    this.send({
      type: 'board:subscribe',
      boardId,
    });
  }

  send(event: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(event));
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.messagesSubject.complete();
    this.connectedSubject.complete();
  }

  private openConnection(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING ||
      this.ticketSubscription
    ) {
      return;
    }

    const attempt = ++this.connectionAttempt;

    this.ticketSubscription = this.boardService.createWebSocketTicket().subscribe({
      next: ({ ticket }) => {
        if (!this.shouldReconnect || attempt !== this.connectionAttempt) {
          return;
        }

        this.ticketSubscription = null;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

        const socket = new WebSocket(
          `${protocol}//localhost:3000/ws?ticket=${encodeURIComponent(ticket)}`,
        );

        this.socket = socket;

        socket.onopen = () => {
          if (this.socket !== socket || !this.shouldReconnect) {
            socket.close();
            return;
          }

          this.connectedSubject.next();
        };

        socket.onmessage = (event: MessageEvent<string>) => {
          if (this.socket !== socket) {
            return;
          }

          try {
            const message = JSON.parse(event.data) as BoardRealtimeMessage;

            this.messagesSubject.next(message);
          } catch (error) {
            console.error('Не удалось обработать WebSocket-событие', error);
          }
        };

        socket.onclose = () => {
          if (this.socket === socket) {
            this.socket = null;
          }

          if (this.shouldReconnect) {
            this.scheduleReconnect(3000);
          }
        };

        socket.onerror = () => socket.close();
      },

      error: (error) => {
        if (attempt !== this.connectionAttempt) {
          return;
        }

        this.ticketSubscription = null;

        console.error('Не удалось получить билет WebSocket', error);

        if (this.shouldReconnect) {
          this.scheduleReconnect(5000);
        }
      },
    });
  }

  private scheduleReconnect(delay: number): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openConnection();
    }, delay);
  }
}
