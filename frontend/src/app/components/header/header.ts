
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { BoardService } from '../../services/board.service';
import {
  NotificationService,
  AppNotification,
} from '../../services/notification.service';
import { CardSearchResult } from '../../../types/CardSearchType';
import { InvitationType } from '../../../types/InvitationType';

type NotificationTab = 'all' | 'notifications' | 'invitations';
type InvitationAction = 'accept' | 'decline';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  readonly activeBoardId = input<string | null>(null);

  readonly searchResultSelected = output<CardSearchResult>();
  readonly notificationSelected = output<{
    boardId: string;
    cardId: string;
  }>();
  readonly boardsListRequested = output<void>();

  readonly authService = inject(AuthService);
  readonly notificationService = inject(NotificationService);

  private readonly boardService = inject(BoardService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchResults = signal<CardSearchResult[]>([]);
  readonly searchOpen = signal(false);
  readonly searchLoading = signal(false);
  readonly searchError = signal(false);

  readonly accountMenuOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly notificationTab = signal<NotificationTab>('all');

  readonly invitations = signal<InvitationType[]>([]);
  readonly invitationsLoading = signal(false);
  readonly invitationsError = signal(false);
  readonly respondingInvitationId = signal<string | null>(null);
  readonly markingAllRead = signal(false);

  // Удаление уведомлений.
  readonly deletingNotificationId = signal<string | null>(null);
  readonly deletingAllNotifications = signal(false);
  readonly notificationDeleteError = signal(false);
  readonly showDeleteAllConfirm = signal(false);

  readonly pendingInvitations = computed(() =>
    this.invitations().filter(
      (invitation) => invitation.status === 'PENDING',
    ),
  );

  readonly pendingInvitationsCount = computed(
    () => this.pendingInvitations().length,
  );

  readonly totalBadgeCount = computed(
    () =>
      this.notificationService.unreadCount() +
      this.pendingInvitationsCount(),
  );

  private searchDebounceTimer?: ReturnType<typeof setTimeout>;
  private searchRequest?: Subscription;
  private invitationRequest?: Subscription;
  private markAllRequest?: Subscription;
  private deleteNotificationRequest?: Subscription;
  private deleteAllNotificationsRequest?: Subscription;

  @ViewChild('searchInput')
  private searchInput?: ElementRef<HTMLInputElement>;

  constructor() {
    this.notificationService.invitationUpdates
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshInvitations());

    this.notificationService.loadNotifications();
    this.notificationService.startRealtime();

    this.refreshInvitations();
  }

  openBoardsList(event: MouseEvent): void {
    event.preventDefault();
    this.boardsListRequested.emit();
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.searchOpen.set(true);
    this.searchError.set(false);

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchRequest?.unsubscribe();

    const query = value.trim();

    if (query.length < 2) {
      this.searchResults.set([]);
      this.searchLoading.set(false);
      return;
    }

    this.searchLoading.set(true);

    this.searchDebounceTimer = setTimeout(() => {
      this.searchRequest = this.boardService
        .searchCards(query, this.activeBoardId())
        .subscribe({
          next: ({ results }) => {
            this.searchResults.set(results);
            this.searchLoading.set(false);
            this.searchError.set(false);
          },
          error: () => {
            this.searchResults.set([]);
            this.searchLoading.set(false);
            this.searchError.set(true);
          },
        });
    }, 250);
  }

  focusSearch(): void {
    this.searchOpen.set(true);
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeSearch();
    }
  }

  openSearchResult(result: CardSearchResult): void {
    this.closeSearch();
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.searchResultSelected.emit(result);
  }

  closeSearch(): void {
    this.searchOpen.set(false);
  }

  toggleAccountMenu(): void {
    this.accountMenuOpen.update((open) => !open);

    if (this.accountMenuOpen()) {
      this.closeNotifications();
    }
  }

  closeAccountMenu(): void {
    this.accountMenuOpen.set(false);
  }

  toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open);

    if (this.notificationsOpen()) {
      this.closeAccountMenu();
      this.notificationService.loadNotifications();
      this.refreshInvitations();
    }
  }

  closeNotifications(): void {
    this.notificationsOpen.set(false);
  }

  setNotificationTab(tab: NotificationTab): void {
    this.notificationTab.set(tab);
  }

  refreshNotifications(): void {
    this.notificationService.loadNotifications();
  }

  refreshInvitations(): void {
    this.invitationRequest?.unsubscribe();
    this.invitationsLoading.set(true);
    this.invitationsError.set(false);

    this.invitationRequest = this.boardService
      .getIncomingInvitations()
      .pipe(finalize(() => this.invitationsLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.invitations.set(response.invitations ?? []);
        },
        error: () => {
          this.invitationsError.set(true);
        },
      });
  }

  respondToInvitation(
    invitationId: string,
    action: InvitationAction,
  ): void {
    if (this.respondingInvitationId()) {
      return;
    }

    this.respondingInvitationId.set(invitationId);

    this.boardService
      .respondToInvitation(invitationId, action)
      .pipe(finalize(() => this.respondingInvitationId.set(null)))
      .subscribe({
        next: () => {
          this.refreshInvitations();
        },
        error: () => {
          this.invitationsError.set(true);
        },
      });
  }

  openNotification(notification: AppNotification): void {
    this.notificationService
      .markAsRead(notification.id)
      .subscribe({ error: () => undefined });

    this.closeNotifications();

    this.notificationSelected.emit({
      boardId: notification.boardId,
      cardId: notification.cardId,
    });
  }

  markAllNotificationsAsRead(): void {
    if (
      this.markingAllRead() ||
      this.notificationService.unreadCount() === 0
    ) {
      return;
    }

    this.markingAllRead.set(true);
    this.markAllRequest?.unsubscribe();

    this.markAllRequest = this.notificationService
      .markAllAsRead()
      .pipe(finalize(() => this.markingAllRead.set(false)))
      .subscribe({ error: () => undefined });
  }

  deleteNotification(notificationId: string): void {
    if (
      this.deletingNotificationId() ||
      this.deletingAllNotifications()
    ) {
      return;
    }

    this.notificationDeleteError.set(false);
    this.deletingNotificationId.set(notificationId);

    this.deleteNotificationRequest?.unsubscribe();

    this.deleteNotificationRequest = this.notificationService
      .deleteNotification(notificationId)
      .pipe(
        finalize(() => this.deletingNotificationId.set(null)),
      )
      .subscribe({
        error: () => {
          this.notificationDeleteError.set(true);
        },
      });
  }

  deleteAllNotifications(): void {
    if (
      this.deletingAllNotifications() ||
      this.deletingNotificationId() ||
      this.notificationService.notifications().length === 0
    ) {
      return;
    }

    this.showDeleteAllConfirm.set(true);
  }


  closeDeleteAllConfirm(): void {
    if (this.deletingAllNotifications()) {
      return;
    }

    this.showDeleteAllConfirm.set(false);
  }

  confirmDeleteAllNotifications(): void {
    if (
      this.deletingAllNotifications() ||
      this.deletingNotificationId()
    ) {
      return;
    }

    this.notificationDeleteError.set(false);
    this.deletingAllNotifications.set(true);
    this.deleteAllNotificationsRequest?.unsubscribe();

    this.deleteAllNotificationsRequest = this.notificationService
      .deleteAllNotifications()
      .pipe(
        finalize(() => {
          this.deletingAllNotifications.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.showDeleteAllConfirm.set(false);
        },
        error: () => {
          this.notificationDeleteError.set(true);
          this.showDeleteAllConfirm.set(false);
        },
      });
  }

  formatNotificationDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  logout(): void {
    this.notificationService.stopRealtime();
    this.authService.logout();
    this.closeAccountMenu();
    this.closeNotifications();
    void this.router.navigate(['/login']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    const element = target as HTMLElement;

    if (!element.closest('.header__search-wrapper')) {
      this.closeSearch();
    }

    if (!element.closest('.header__account-wrapper')) {
      this.closeAccountMenu();
    }

    if (!element.closest('.header__notifications-wrapper')) {
      this.closeNotifications();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onSearchShortcut(event: KeyboardEvent): void {
    const isSearchShortcut =
      (event.ctrlKey || event.metaKey) &&
      event.code === 'KeyK'

    if (isSearchShortcut) {
      event.preventDefault();
      event.stopPropagation();

      this.openSearchWithShortcut();
      return;
    }

    if (event.key === 'Escape') {
      this.closeSearch();
      this.closeNotifications();
      this.closeAccountMenu();
    }
  }

  private openSearchWithShortcut(): void {
    this.searchOpen.set(true);

    requestAnimationFrame(() => {
      this.searchInput?.nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchRequest?.unsubscribe();
    this.invitationRequest?.unsubscribe();
    this.markAllRequest?.unsubscribe();
    this.deleteNotificationRequest?.unsubscribe();
    this.deleteAllNotificationsRequest?.unsubscribe();
  }


}
