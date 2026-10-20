import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BoardService } from './board.service';
import { EMPTY, Observable, Subject, catchError, finalize, tap } from 'rxjs';

export type NotificationType = 'CARD_ASSIGNED' | 'CARD_UNASSIGNED';

export interface AppNotification {
  id: string;
  recipientId: string;
  type: NotificationType;
  actorName: string;
  boardId: string;
  boardTitle: string;
  cardId: string;
  cardTitle: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

interface RealtimeEvent {
  type?: string;
  payload?: AppNotification;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly boardService = inject(BoardService);
  private readonly serverUnreadCount = signal(0);

  private readonly apiUrl = 'http://localhost:3000/api/notifications';

  readonly notifications = signal<AppNotification[]>([]);

  readonly unreadCount = this.serverUnreadCount.asReadonly();

  readonly loading = signal(false);
  readonly error = signal(false);

  // Событие для обновления списка входящих приглашений.
  readonly invitationUpdates = new Subject<void>();

  private socket: WebSocket | null = null;
  private started = false;
  private destroyed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;

  loadNotifications(): void {
    this.loading.set(true);
    this.error.set(false);

    this.http
      .get<NotificationsResponse>(this.apiUrl)
      .pipe(
        tap((response) => {
          this.notifications.set(response.notifications ?? []);
          this.serverUnreadCount.set(response.unreadCount ?? 0);
        }),
        catchError(() => {
          this.error.set(true);
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe();
  }

  startRealtime(): void {
    if (this.started && !this.destroyed) {
      return;
    }

    this.destroyed = false;
    this.started = true;
    this.connect();
  }

  stopRealtime(): void {
    this.destroyed = true;
    this.started = false;
    this.generation++;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      socket.close();
    }
  }

  markAsRead(notificationId: string): Observable<unknown> {
    const notification = this.notifications().find((item) => item.id === notificationId);

    if (!notification || notification.readAt) {
      return EMPTY;
    }

    return this.http.patch<{ success: boolean }>(`${this.apiUrl}/${notificationId}/read`, {}).pipe(
      tap(() => {
        const readAt = new Date().toISOString();

        this.notifications.update((items) =>
          items.map((item) => (item.id === notificationId ? { ...item, readAt } : item)),
        );

        this.serverUnreadCount.update((count) => Math.max(0, count - 1));
      }),
    );
  }

  markAllAsRead(): Observable<unknown> {
    if (this.unreadCount() === 0) {
      return EMPTY;
    }

    return this.http.patch<{ message: string }>(`${this.apiUrl}/read-all`, {}).pipe(
      tap(() => {
        const readAt = new Date().toISOString();

        this.notifications.update((items) =>
          items.map((item) => (item.readAt ? item : { ...item, readAt })),
        );
        this.serverUnreadCount.set(0);
      }),
    );
  }

  private connect(): void {
    if (this.destroyed) {
      return;
    }

    const connectionGeneration = ++this.generation;

    this.boardService
      .createWebSocketTicket()
      .pipe(
        catchError(() => {
          this.scheduleReconnect(connectionGeneration);
          return EMPTY;
        }),
      )
      .subscribe(({ ticket }) => {
        if (this.destroyed || connectionGeneration !== this.generation) {
          return;
        }

        let socket: WebSocket;

        try {
          socket = new WebSocket(`ws://localhost:3000/ws?ticket=${encodeURIComponent(ticket)}`);
        } catch {
          this.scheduleReconnect(connectionGeneration);
          return;
        }

        this.socket = socket;

        socket.addEventListener('open', () => {
          if (this.socket !== socket || this.destroyed) {
            return;
          }

          // При подключении сверяем приглашения с сервером,
          // чтобы не пропустить события, пришедшие офлайн.
          this.invitationUpdates.next();
        });

        socket.addEventListener('message', (event: MessageEvent<string>) => {
          if (this.socket !== socket || this.destroyed) {
            return;
          }

          try {
            const data = JSON.parse(event.data) as RealtimeEvent;

            if (
              data.type === 'notification:new' &&
              data.payload &&
              typeof data.payload.id === 'string'
            ) {
              this.addNotification(data.payload);
              return;
            }

            if (data.type === 'invitations:changed') {
              this.invitationUpdates.next();
            }
          } catch {
            // Игнорируем сообщения, которые не удалось разобрать.
          }
        });

        socket.addEventListener('close', () => {
          if (this.socket !== socket) {
            return;
          }

          this.socket = null;
          this.scheduleReconnect(connectionGeneration);
        });

        socket.addEventListener('error', () => {
          if (socket.readyState !== WebSocket.CLOSED) {
            socket.close();
          }
        });
      });
  }

  private addNotification(notification: AppNotification): void {
    let added = false;

    this.notifications.update((items) => {
      if (items.some((item) => item.id === notification.id)) {
        return items;
      }

      added = true;
      return [notification, ...items].slice(0, 100);
    });

    if (added && !notification.readAt) {
      this.serverUnreadCount.update((count) => count + 1);
    }
  }

  private scheduleReconnect(generation: number): void {
    if (this.destroyed || generation !== this.generation) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      if (!this.destroyed && generation === this.generation) {
        this.connect();
      }
    }, 3000);
  }

  deleteNotification(notificationId: string): Observable<unknown> {
    const notification = this.notifications().find((item) => item.id === notificationId);

    if (!notification) {
      return EMPTY;
    }

    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${notificationId}`).pipe(
      tap(() => {
        this.notifications.update((items) => items.filter((item) => item.id !== notificationId));

        if (!notification.readAt) {
          this.serverUnreadCount.update((count) => Math.max(0, count - 1));
        }
      }),
    );
  }

  deleteAllNotifications(): Observable<unknown> {
    if (this.notifications().length === 0) {
      return EMPTY;
    }

    return this.http.delete<{ success: boolean; deletedCount: number }>(this.apiUrl).pipe(
      tap(() => {
        this.notifications.set([]);
        this.serverUnreadCount.set(0);
      }),
    );
  }
}
