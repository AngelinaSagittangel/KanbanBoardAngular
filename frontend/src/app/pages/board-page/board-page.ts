import { Component, HostListener, inject, OnDestroy, OnInit, signal } from '@angular/core';

import { KanbanColumn } from '../../components/kanban-column/kanban-column';
import { CardFormModal } from '../../components/card-form-modal/card-form-modal';
import { HeaderComponent } from '../../components/header/header';

import { KanbanColumnType } from '../../../types/KanbanColumnType';
import { PendingDeletionType } from '../../../types/PendingDeletionType';
import { ChecklistItemType, KanbanCardType } from '../../../types/KanbanCardType';
import { ColumnColor } from '../../../types/ColumnColor';
import { BoardMemberType, BoardType } from '../../../types/BoardType';
import { CardSearchResult } from '../../../types/CardSearchType';
import { InvitationAction, InvitationType } from '../../../types/InvitationType';

import { BoardService } from '../../services/board.service';
import { AuthService } from '../../services/auth.service';
import { ConfirmModal } from '../../components/confirm-modal/confirm-modal';
import { BoardRealtimeMessage, BoardRealtimeService } from '../../services/board-realtime.service';
import { finalize, Subscription } from 'rxjs';
import { CardDeletionService } from '../../services/card-deletion.service';
import { mapApiCardToKanbanCard } from '../../mappers/card.mapper';
import {
  mapApiColumnToKanbanColumn,
  moveCardBetweenColumns,
  updateCardInColumns,
} from '../../mappers/column.mapper';
import { appendCardToColumn, removeCardFromColumn } from '../../../utils/column-state.utils';

@Component({
  selector: 'app-board-page',
  imports: [KanbanColumn, HeaderComponent, CardFormModal, ConfirmModal],
  templateUrl: './board-page.html',
  styleUrl: './board-page.scss',
})
export class BoardPage implements OnInit, OnDestroy {
  private readonly boardService = inject(BoardService);
  private readonly authService = inject(AuthService);
  private readonly realtimeService = inject(BoardRealtimeService);
  private readonly cardDeletionService = inject(CardDeletionService);

  private realtimeMessageSubscription: Subscription | null = null;
  private realtimeConnectedSubscription: Subscription | null = null;

  cardFormModalOpen = signal(false);
  cardActivityRefreshKey = signal(0);
  cardSaveError = signal('');
  activeCardColumnId = signal<string | null>(null);
  editingCard = signal<KanbanCardType | null>(null);
  memberActionId = signal<string | null>(null);
  memberActionError = signal('');
  memberActionSuccess = signal('');
  boardMembersLoading = signal(false);
  memberToRemove = signal<{
    userId: string;
    name: string;
  } | null>(null);
  leaveBoardModalOpen = signal(false);
  boardLeaving = signal(false);
  leaveBoardError = signal('');
  leaveBoardTitle = signal('');
  private invitationSuccessTimer: ReturnType<typeof setTimeout> | null = null;
  private memberActionSuccessTimer: ReturnType<typeof setTimeout> | null = null;
  private invitationErrorTimer: ReturnType<typeof setTimeout> | null = null;

  boards = signal<BoardType[]>([]);
  boardsLoaded = signal(false);
  boardDeletedNotice = signal('');

  private boardSelectionRequestId = 0;
  columns = signal<KanbanColumnType[]>([]);
  activeBoardId = signal<string | null>(null);
  highlightedCardId = signal<string | null>(null);
  pendingDeletions = signal<PendingDeletionType[]>([]);

  columnPendingDelete = signal<KanbanColumnType | null>(null);

  boardTitle = signal('Моя доска');
  boardDescription = signal('Все задачи в одном месте. Спокойно движемся к цели.');

  editingBoardTitle = signal(false);
  editingBoardDescription = signal(false);

  boardTitleDraft = signal('');
  boardDescriptionDraft = signal('');

  boardsMenuOpen = signal(false);
  boardMenuOpen = signal(false);

  deleteBoardModalOpen = signal(false);
  boardPendingDelete = signal<BoardType | null>(null);
  boardDeleting = signal(false);

  createBoardModalOpen = signal(false);
  newBoardTitle = signal('');
  newBoardDescription = signal('');

  shareModalOpen = signal(false);
  inviteEmail = signal('');
  invitationSending = signal(false);
  invitationError = signal('');
  invitationSuccess = signal('');

  boardMembers = signal<BoardMemberType[]>([]);
  boardOwner = signal<{ id: string; name: string } | null>(null);

  incomingInvitations = signal<InvitationType[]>([]);
  invitationsLoading = signal(false);
  incomingInvitationsError = signal('');

  respondingInvitationId = signal<string | null>(null);
  editingCards = signal<Record<string, string>>({});
  editingCardConflict = signal<{ cardId: string; userId: string } | null>(null);

  private boardCheckInProgress = false;
  private boardRefreshPending = false;
  private editingBoardByCard = new Map<string, string>();

  startCardEditing(cardId: string): void {
    this.editingCardConflict.set(null);

    const boardId = this.activeBoardId();

    if (!boardId || !this.realtimeService.isConnected) {
      return;
    }

    this.editingBoardByCard.set(cardId, boardId);

    this.realtimeService.send({
      type: 'card:edit:start',
      boardId,
      cardId,
    });
  }

  stopCardEditing(cardId: string): void {
    const boardId = this.editingBoardByCard.get(cardId);

    if (!boardId) {
      return;
    }

    this.editingBoardByCard.delete(cardId);

    this.realtimeService.send({
      type: 'card:edit:stop',
      boardId,
      cardId,
    });
  }

  ngOnInit(): void {
    this.loadBoards();
    this.setupRealtime();
  }

  private setupRealtime(): void {
    this.realtimeMessageSubscription = this.realtimeService.messages$.subscribe((message) => {
      this.handleRealtimeMessage(message);
    });

    this.realtimeConnectedSubscription = this.realtimeService.connected$.subscribe(() => {
      const boardId = this.activeBoardId();

      if (boardId) {
        this.subscribeToBoard(boardId);
      }
    });

    this.realtimeService.connect();
  }

  private handleRealtimeMessage(message: BoardRealtimeMessage): void {
    const payload = message.payload;

    if (message.type === 'card:editing' && payload?.boardId && payload.cardId && payload.userId) {
      if (payload.boardId !== this.activeBoardId()) {
        return;
      }

      if (payload.userId === this.authService.user()?.id) {
        return;
      }

      this.editingCards.update((cards) => ({
        ...cards,
        [payload.cardId!]: payload.userId!,
      }));

      return;
    }

    if (
      message.type === 'card:edit:ended' &&
      payload?.boardId === this.activeBoardId() &&
      payload.cardId &&
      payload.userId
    ) {
      this.editingCards.update((cards) => {
        if (cards[payload.cardId!] !== payload.userId) {
          return cards;
        }

        const updated = { ...cards };
        delete updated[payload.cardId!];

        return updated;
      });

      return;
    }

    if (
      message.type === 'card:edit:conflict' &&
      payload?.boardId === this.activeBoardId() &&
      payload.cardId &&
      payload.userId
    ) {
      this.editingCardConflict.set({
        cardId: payload.cardId,
        userId: payload.userId,
      });

      return;
    }

    if (message.type === 'board:changed' && payload?.boardId) {
      if (payload.boardId !== this.activeBoardId()) {
        return;
      }

      const board = this.boards().find((item) => item.id === payload.boardId);

      if (!board) {
        return;
      }

      if (
        payload.entity === 'card' &&
        payload.entityId &&
        this.editingCard()?.id === payload.entityId
      ) {
        this.cardActivityRefreshKey.update((value) => value + 1);
      }

      this.selectBoard(board);

      if (payload.entity === 'board') {
        this.refreshBoardsList();
      }

      return;
    }

    if (message.type === 'board:deleted' && payload) {
      this.handleBoardDeleted(payload);
      return;
    }

    if (message.type === 'board:unavailable' && payload?.boardId === this.activeBoardId()) {
      this.handleUnavailableAfterReconnect();
      return;
    }

    if (message.type === 'board:access-revoked' && payload?.boardId) {
      if (payload.boardId === this.activeBoardId()) {
        this.handleAccessRevoked({
          boardId: payload.boardId,
          boardTitle: payload.boardTitle,
          reason: payload.reason,
        });
      } else {
        this.refreshBoardsList();
      }
    }
  }

  editingUserName(userId: string): string {
    const owner = this.boardOwner();

    if (owner?.id === userId) {
      return owner.name;
    }

    const member = this.boardMembers().find((item) => item.userId === userId);

    return member?.user.name ?? 'Другой участник';
  }

  private handleAccessRevoked(payload: {
    boardId: string;
    boardTitle?: string;
    reason?: 'removed' | 'left';
  }): void {
    if (this.activeBoardId() !== payload.boardId) {
      return;
    }

    const title = payload.boardTitle || this.boardTitle();

    if (this.deleteBoardModalOpen() && !this.boardDeleting()) {
      this.cancelBoardDelete();
    }

    this.resetActiveBoardState();

    this.boardDeletedNotice.set(
      payload.reason === 'left'
        ? `Вы покинули доску «${title}»`
        : `Доступ к доске «${title}» отозван`,
    );

    this.refreshBoardsList();
  }

  private subscribeToBoard(boardId: string): void {
    this.realtimeService.subscribeToBoard(boardId);
  }

  private handleUnavailableAfterReconnect(): void {
    const title = this.boardTitle();

    this.resetActiveBoardState();

    this.boardDeletedNotice.set(`Доска «${title}» больше недоступна`);

    this.refreshBoardsList();
  }

  private handleBoardDeleted(payload: {
    boardId?: string;
    boardTitle?: string;
    ownerId?: string;
  }): void {
    if (!payload.boardId || this.activeBoardId() !== payload.boardId) {
      return;
    }

    if (payload.ownerId === this.authService.user()?.id) {
      return;
    }

    const title = payload.boardTitle || this.boardTitle();

    this.resetActiveBoardState();

    this.deleteBoardModalOpen.set(false);
    this.boardPendingDelete.set(null);
    this.boardDeleting.set(false);

    this.boardDeletedNotice.set(`Владелец доски «${title}» удалил эту доску`);

    this.refreshBoardsList();
  }

  loadBoards(): void {
    this.resetActiveBoardState();
    this.boardDeletedNotice.set('');
    this.boardsLoaded.set(false);

    this.boardService.getBoards().subscribe({
      next: (response) => {
        this.boards.set(response.boards);
        this.boardsLoaded.set(true);
      },
      error: (error) => {
        console.error('Не удалось загрузить доски', error);
        this.boardsLoaded.set(true);
      },
    });
  }

  private refreshBoardsList(): void {
    if (this.boardCheckInProgress) {
      this.boardRefreshPending = true;
      return;
    }

    this.boardCheckInProgress = true;

    const checkedBoardId = this.activeBoardId();

    this.boardService
      .getBoards()
      .pipe(
        finalize(() => {
          this.boardCheckInProgress = false;
          if (this.boardRefreshPending) {
            this.boardRefreshPending = false;
            this.refreshBoardsList();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          const availableBoards = response.boards;

          this.boards.set(availableBoards);
          this.boardsLoaded.set(true);

          if (
            checkedBoardId &&
            this.activeBoardId() === checkedBoardId &&
            !availableBoards.some((board) => board.id === checkedBoardId)
          ) {
            this.handleUnavailableActiveBoard(availableBoards);
          }
        },
        error: (error) => {
          console.error('Не удалось обновить список досок', error);
        },
      });
  }

  private handleUnavailableActiveBoard(availableBoards: BoardType[]): void {
    if (this.deleteBoardModalOpen() && !this.boardDeleting()) {
      this.cancelBoardDelete();
    }

    this.resetActiveBoardState();

    if (availableBoards.length > 0) {
      this.selectBoard(availableBoards[0]);
    }
  }

  openBoardsList(): void {
    const pendingCardIds = this.pendingDeletions().map(
      (item) => item.card.id,
    );

    for (const cardId of pendingCardIds) {
      this.cancelDelete(cardId);
    }
    this.activeBoardId.set(null);
    this.highlightedCardId.set(null);
    this.closeBoardsMenu();
    this.closeBoardMenu();
  }

  selectBoard(board: BoardType, cardIdToHighlight?: string): void {
    const currentBoardId = this.activeBoardId();
    if (currentBoardId !== board.id) {
      const pendingCardIds = this.pendingDeletions().map((item) => item.card.id);

      for (const cardId of pendingCardIds) {
        this.cancelDelete(cardId);
      }
    }

    const requestId = ++this.boardSelectionRequestId;

    this.boardService.getBoard(board.id).subscribe({
      next: (response) => {
        if (requestId !== this.boardSelectionRequestId) {
          return;
        }
        const selectedBoard = response.board;

        this.editingCards.set({});
        this.editingCardConflict.set(null);

        this.boardTitle.set(selectedBoard.title);
        this.boardDescription.set(selectedBoard.description ?? '');
        this.activeBoardId.set(selectedBoard.id);
        this.boardDeletedNotice.set('');

        this.subscribeToBoard(selectedBoard.id);

        this.boardOwner.set(selectedBoard.owner ?? null);
        this.boardMembers.set(selectedBoard.members ?? []);

        this.columns.set(selectedBoard.columns.map(mapApiColumnToKanbanColumn));

        const cardExists = selectedBoard.columns.some((column) =>
          column.cards.some((card) => card.id === cardIdToHighlight),
        );

        this.highlightedCardId.set(cardIdToHighlight && cardExists ? cardIdToHighlight : null);

        this.closeBoardsMenu();
        this.closeBoardMenu();
      },
      error: (error) => {
        console.error('Не удалось загрузить доску', error);
      },
    });
  }

  createCard(columnId: string, cardData: Omit<KanbanCardType, 'id' | 'updatedAt'>): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    this.boardService
      .createCard(boardId, columnId, {
        title: cardData.title,
        description: cardData.description || null,
        dueDate: cardData.dueDate ? new Date(cardData.dueDate).toISOString() : null,
        label: cardData.label || null,
        labelColor: cardData.labelColor || null,
        checklist: cardData.checklist ?? [],
        assigneeId: this.isActiveBoardOwner() ? (cardData.assigneeId ?? null) : null,
      })
      .subscribe({
        next: ({ card }) => {
          const newCard = mapApiCardToKanbanCard(card);

          this.columns.update((columns) => appendCardToColumn(columns, columnId, newCard));
          this.closeCardForm();
        },
        error: (error) => {
          console.error('Не удалось создать карточку', error);
        },
      });
  }

  renameColumn(columnId: string, newTitle: string): void {
    const boardId = this.activeBoardId();
    const title = newTitle.trim().slice(0, 100);

    if (!boardId || !title) {
      return;
    }

    this.boardService.updateColumn(boardId, columnId, { title }).subscribe({
      next: ({ column }) => {
        this.columns.update((columns) =>
          columns.map((item) => (item.id === columnId ? { ...item, title: column.title } : item)),
        );
      },
      error: (error) => {
        console.error('Не удалось переименовать колонку', error);
      },
    });
  }

  changeColumnColor(event: { columnId: string; color: ColumnColor }): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    this.boardService
      .updateColumn(boardId, event.columnId, {
        color: event.color,
      })
      .subscribe({
        next: ({ column }) => {
          this.columns.update((columns) =>
            columns.map((item) =>
              item.id === event.columnId
                ? {
                    ...item,
                    color: column.color as ColumnColor,
                  }
                : item,
            ),
          );
        },
        error: (error) => {
          console.error('Не удалось изменить цвет колонки', error);
        },
      });
  }

  deleteColumn(columnId: string): void {
    const column = this.columns().find((item) => item.id === columnId);

    if (!column) {
      return;
    }

    this.columnPendingDelete.set(column);
  }

  cancelColumnDelete(): void {
    this.columnPendingDelete.set(null);
  }

  confirmColumnDelete(): void {
    const column = this.columnPendingDelete();
    const boardId = this.activeBoardId();

    if (!column || !boardId) {
      return;
    }

    this.boardService.deleteColumn(boardId, column.id).subscribe({
      next: () => {
        const pendingInColumn = this.pendingDeletions().filter(
          (item) => item.columnId === column.id,
        );

        for (const pending of pendingInColumn) {
          this.cardDeletionService.cancel(pending.card.id);
        }

        this.pendingDeletions.update((items) =>
          items.filter((item) => item.columnId !== column.id),
        );

        this.columns.update((columns) => columns.filter((item) => item.id !== column.id));

        this.columnPendingDelete.set(null);
      },
      error: (error) => {
        console.error('Не удалось удалить колонку', error);
      },
    });
  }

  toggleCardCompletion(cardId: string): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    const column = this.columns().find((item) => item.cards.some((card) => card.id === cardId));

    const currentCard = column?.cards.find((card) => card.id === cardId);

    if (!column || !currentCard) {
      return;
    }

    this.boardService
      .updateCard(boardId, column.id, cardId, {
        expectedUpdatedAt: currentCard.updatedAt,
        completed: !currentCard.completed,
      })
      .subscribe({
        next: ({ card }) => {
          this.columns.update((columns) =>
            updateCardInColumns(columns, column.id, cardId, (currentCard) => ({
              ...currentCard,
              completed: card.completed,
              updatedAt: card.updatedAt,
            })),
          );
        },
        error: (error) => {
          console.error('Не удалось изменить статус задачи', error);

          if (error.status === 409 && error.error?.code === 'CARD_EDIT_CONFLICT') {
            const board = this.boards().find((item) => item.id === boardId);

            if (board) {
              this.selectBoard(board);
            }
          }
        },
      });
  }

  openSearchResult(result: CardSearchResult): void {
    if (result.boardId === this.activeBoardId()) {
      this.highlightedCardId.set(result.cardId);
      return;
    }

    const board = this.boards().find((item) => item.id === result.boardId);

    if (board) {
      this.selectBoard(board, result.cardId);
    }
  }

  openCardFromNotification(event: { boardId: string; cardId: string }): void {
    if (event.boardId === this.activeBoardId()) {
      const cardExists = this.columns().some((column) =>
        column.cards.some((card) => card.id === event.cardId),
      );

      if (cardExists) {
        this.highlightedCardId.set(event.cardId);
      }

      return;
    }

    const board = this.boards().find((item) => item.id === event.boardId);

    if (board) {
      this.selectBoard(board, event.cardId);
      return;
    }

    this.boardService.getBoard(event.boardId).subscribe({
      next: ({ board: loadedBoard }) => {
        this.selectBoard(loadedBoard, event.cardId);
      },
      error: (error) => {
        console.error('Не удалось открыть доску из уведомления', error);
      },
    });
  }

  addColumn(): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    this.boardService.createColumn(boardId, 'Новая колонка').subscribe({
      next: ({ column }) => {
        const newColumn: KanbanColumnType = {
          id: column.id,
          title: column.title,
          color: 'gray',
          cards: [],
          note: '',
        };

        this.columns.update((columns) => [...columns, newColumn]);
      },
      error: (error) => {
        console.error('Не удалось создать колонку', error);
      },
    });
  }

  updateCard(updatedCard: KanbanCardType): void {
    this.cardSaveError.set('');

    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    const column = this.columns().find((item) =>
      item.cards.some((card) => card.id === updatedCard.id),
    );

    if (!column) {
      return;
    }

    const isOwner = this.isActiveBoardOwner();

    const payload = {
      expectedUpdatedAt: updatedCard.updatedAt,
      title: updatedCard.title,
      description: updatedCard.description,
      completed: updatedCard.completed,
      dueDate: updatedCard.dueDate ? new Date(updatedCard.dueDate).toISOString() : null,
      label: updatedCard.label ?? null,
      checklist: updatedCard.checklist ?? [],
      labelColor: updatedCard.labelColor ?? null,

      ...(isOwner && {
        assigneeId: updatedCard.assigneeId ?? null,
      }),
    };

    this.boardService.updateCard(boardId, column.id, updatedCard.id, payload).subscribe({
      next: ({ card }) => {
        const updatedCardData = mapApiCardToKanbanCard(card);

        this.columns.update((columns) =>
          updateCardInColumns(columns, column.id, card.id, () => updatedCardData),
        );

        this.closeCardForm();
      },

      error: (error) => {
        console.error('Не удалось обновить карточку', error);

        if (error.status === 409 && error.error?.code === 'CARD_EDIT_CONFLICT') {
          this.cardSaveError.set(
            'Другой участник изменил карточку. Твои данные сохранены в форме. Проверь актуальную версию и подтверди перезапись, если хочешь оставить свои изменения.',
          );

          const board = this.boards().find((item) => item.id === this.activeBoardId());

          if (board) {
            this.selectBoard(board);
          }

          return;
        }

        this.cardSaveError.set(
          error.error?.message || 'Не удалось сохранить карточку. Попробуй ещё раз.',
        );
      },
    });
  }

  deleteCard(cardId: string): void {
    const boardId = this.activeBoardId();

    if (!boardId) return;

    const columns = this.columns();
    const sourceColumn = columns.find((column) => column.cards.some((card) => card.id === cardId));

    if (!sourceColumn) return;

    const index = sourceColumn.cards.findIndex((card) => card.id === cardId);
    const card = sourceColumn.cards[index];

    if (!card) return;

    this.cardDeletionService.cancel(cardId);

    this.pendingDeletions.update((items) => [
      ...items.filter((item) => item.card.id !== cardId),
      { card, columnId: sourceColumn.id, index },
    ]);

    this.columns.update((currentColumns) =>
      removeCardFromColumn(currentColumns, sourceColumn.id, cardId),
    );

    this.cardDeletionService.schedule(cardId, () => {
      if (this.activeBoardId() !== boardId) {
        this.pendingDeletions.update((items) => items.filter((item) => item.card.id !== cardId));
        return;
      }

      this.boardService.deleteCard(boardId, sourceColumn.id, cardId).subscribe({
        next: () => {
          this.pendingDeletions.update((items) => items.filter((item) => item.card.id !== cardId));
        },
        error: (error) => {
          console.error('Не удалось удалить карточку:', error);

          if (this.activeBoardId() === boardId) {
            this.cancelDelete(cardId);
          }
        },
      });
    });
  }

  cancelDelete(cardId: string): void {
    this.cardDeletionService.cancel(cardId);

    const pending = this.pendingDeletions().find((item) => item.card.id === cardId);

    if (!pending) {
      return;
    }

    this.columns.update((columns) =>
      columns.map((column) => {
        if (column.id !== pending.columnId) {
          return column;
        }

        if (column.cards.some((card) => card.id === cardId)) {
          return column;
        }

        const cards = [...column.cards];
        const index = Math.min(pending.index, cards.length);

        cards.splice(index, 0, pending.card);

        return {
          ...column,
          cards,
        };
      }),
    );

    this.pendingDeletions.update((items) => items.filter((item) => item.card.id !== cardId));
  }

  moveCard(cardId: string, targetColumnId: string): void {
    const boardId = this.activeBoardId();
    const columns = this.columns();

    if (!boardId) {
      return;
    }

    const sourceColumn = columns.find((column) => column.cards.some((card) => card.id === cardId));
    const targetColumn = columns.find((column) => column.id === targetColumnId);
    if (!sourceColumn || !targetColumn || sourceColumn.id === targetColumn.id) {
      return;
    }

    const card = sourceColumn.cards.find((item) => item.id === cardId);
    if (!card) {
      return;
    }

    this.boardService
      .moveCard(boardId, cardId, targetColumnId, targetColumn.cards.length)
      .subscribe({
        next: () => {
          this.columns.update((currentColumns) =>
            moveCardBetweenColumns(currentColumns, cardId, sourceColumn.id, targetColumnId),
          );
        },
        error: (error) => {
          console.error('Не удалось переместить карточку', error);
        },
      });
  }

  startBoardTitleEditing(): void {
    this.editingBoardDescription.set(false);
    this.boardTitleDraft.set(this.boardTitle());
    this.editingBoardTitle.set(true);
  }

  updateBoardTitleDraft(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.boardTitleDraft.set(input.value);
  }

  saveBoardTitle(): void {
    const boardId = this.activeBoardId();
    const title = this.boardTitleDraft().trim().slice(0, 100);

    if (!title) {
      this.boardTitleDraft.set(this.boardTitle());
      this.editingBoardTitle.set(false);
      return;
    }

    if (!boardId) {
      this.editingBoardTitle.set(false);
      return;
    }

    if (title === this.boardTitle()) {
      this.editingBoardTitle.set(false);
      return;
    }

    this.boardService.updateBoard(boardId, { title }).subscribe({
      next: ({ board }) => {
        this.boardTitle.set(board.title);

        this.boards.update((boards) =>
          boards.map((item) => (item.id === board.id ? { ...item, title: board.title } : item)),
        );

        this.boardTitleDraft.set(board.title);
        this.editingBoardTitle.set(false);
      },
      error: (error) => {
        console.error('Не удалось сохранить название доски', error);
        this.boardTitleDraft.set(this.boardTitle());
        this.editingBoardTitle.set(false);
      },
    });
  }

  cancelBoardTitleEditing(): void {
    this.boardTitleDraft.set(this.boardTitle());
    this.editingBoardTitle.set(false);
  }

  startBoardDescriptionEditing(): void {
    this.editingBoardTitle.set(false);
    this.boardDescriptionDraft.set(this.boardDescription());
    this.editingBoardDescription.set(true);
  }

  updateBoardDescriptionDraft(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.boardDescriptionDraft.set(textarea.value);
  }

  saveBoardDescription(): void {
    const boardId = this.activeBoardId();
    const description = this.boardDescriptionDraft().trim().slice(0, 500);

    if (!boardId) {
      this.editingBoardDescription.set(false);
      return;
    }

    if (description === this.boardDescription()) {
      this.editingBoardDescription.set(false);
      return;
    }

    this.boardService
      .updateBoard(boardId, {
        description: description || null,
      })
      .subscribe({
        next: ({ board }) => {
          this.boardDescription.set(board.description ?? '');

          this.boards.update((boards) =>
            boards.map((item) =>
              item.id === board.id
                ? {
                    ...item,
                    description: board.description ?? null,
                  }
                : item,
            ),
          );

          this.boardDescriptionDraft.set(board.description ?? '');
          this.editingBoardDescription.set(false);
        },
        error: (error) => {
          console.error('Не удалось сохранить описание доски', error);
          this.boardDescriptionDraft.set(this.boardDescription());
          this.editingBoardDescription.set(false);
        },
      });
  }

  cancelBoardDescriptionEditing(): void {
    this.boardDescriptionDraft.set(this.boardDescription());
    this.editingBoardDescription.set(false);
  }

  toggleBoardsMenu(): void {
    const willOpen = !this.boardsMenuOpen();

    this.boardsMenuOpen.set(willOpen);
    this.boardMenuOpen.set(false);

    if (willOpen) {
      this.refreshBoardsList();
    }
  }

  closeBoardsMenu(): void {
    this.boardsMenuOpen.set(false);
  }

  toggleBoardMenu(): void {
    this.boardMenuOpen.update((isOpen) => !isOpen);
  }

  closeBoardMenu(): void {
    this.boardMenuOpen.set(false);
  }

  editBoardTitleFromMenu(): void {
    this.closeBoardMenu();
    this.startBoardTitleEditing();
  }

  editBoardDescriptionFromMenu(): void {
    this.closeBoardMenu();
    this.startBoardDescriptionEditing();
  }

  openCreateBoard(): void {
    this.createBoardModalOpen.set(true);
    this.newBoardTitle.set('');
    this.newBoardDescription.set('');
  }

  createBoard(): void {
    const title = this.newBoardTitle().trim();
    const description = this.newBoardDescription().trim();

    if (!title) {
      return;
    }

    this.boardService
      .createBoard({
        title,
        description: description || null,
      })
      .subscribe({
        next: (response) => {
          this.boards.update((boards) => [...boards, response.board]);

          this.selectBoard(response.board);
          this.createBoardModalOpen.set(false);
          this.newBoardTitle.set('');
          this.newBoardDescription.set('');
        },
        error: (error) => {
          console.error('Не удалось создать доску', error);
        },
      });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (!target.closest('.kanban__boards-selector')) {
      this.closeBoardsMenu();
    }

    if (!target.closest('.kanban__board-menu-wrapper')) {
      this.closeBoardMenu();
    }

    const clickedBoardInfo = target.closest('.kanban__board-info');
    const clickedBoardMenu = target.closest('.kanban__board-menu-wrapper');

    if (!clickedBoardInfo && !clickedBoardMenu) {
      if (this.editingBoardTitle()) {
        this.saveBoardTitle();
      }

      if (this.editingBoardDescription()) {
        this.saveBoardDescription();
      }
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.closeBoardsMenu();
    this.closeBoardMenu();

    if (this.shareModalOpen()) {
      this.closeShareModal();
    }

    if (this.columnPendingDelete()) {
      this.cancelColumnDelete();
    }

    if (this.deleteBoardModalOpen() && !this.boardDeleting()) {
      this.cancelBoardDelete();
    }

    if (this.leaveBoardModalOpen() && !this.boardLeaving()) {
      this.cancelLeaveBoard();
    }
  }

  updateChecklist(event: { cardId: string; checklist: ChecklistItemType[] }): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    const column = this.columns().find((item) =>
      item.cards.some((card) => card.id === event.cardId),
    );

    if (!column) {
      return;
    }

    const currentCard = column.cards.find((card) => card.id === event.cardId);

    if (!currentCard) {
      return;
    }

    const previousChecklist = currentCard.checklist ?? [];

    this.columns.update((columns) =>
      columns.map((item) =>
        item.id === column.id
          ? {
              ...item,
              cards: item.cards.map((card) =>
                card.id === event.cardId ? { ...card, checklist: event.checklist } : card,
              ),
            }
          : item,
      ),
    );

    this.boardService
      .updateCard(boardId, column.id, event.cardId, {
        expectedUpdatedAt: currentCard.updatedAt,
        checklist: event.checklist,
      })
      .subscribe({
        next: ({ card }) => {
          this.columns.update((columns) =>
            updateCardInColumns(columns, column.id, card.id, (currentCard) => ({
              ...currentCard,
              checklist: card.checklist ?? [],
              updatedAt: card.updatedAt,
            })),
          );
        },
        error: (error) => {
          console.error('Не удалось сохранить чек-лист', error);
          if (error.status === 409 && error.error?.code === 'CARD_EDIT_CONFLICT') {
            const board = this.boards().find((item) => item.id === boardId);

            if (board) {
              this.selectBoard(board);
            }

            return;
          }
          this.columns.update((columns) =>
            updateCardInColumns(columns, column.id, event.cardId, (card) => ({
              ...card,
              checklist: previousChecklist,
            })),
          );
        },
      });
  }

  openCardForm(event: { columnId: string; card?: KanbanCardType }): void {
    this.cardSaveError.set('');
    this.activeCardColumnId.set(event.columnId);
    this.editingCard.set(event.card ?? null);
    this.cardFormModalOpen.set(true);
  }

  getCardsForColumn(columnId: string): KanbanCardType[] {
    return this.columns().find((column) => column.id === columnId)?.cards ?? [];
  }

  closeCardForm(): void {
    this.cardSaveError.set('');
    this.cardFormModalOpen.set(false);
    this.activeCardColumnId.set(null);
    this.editingCard.set(null);
  }

  openDeleteBoardModal(): void {
    const boardId = this.activeBoardId();

    if (!boardId || this.boardDeleting()) {
      return;
    }

    const board = this.boards().find((item) => item.id === boardId);

    if (!board) {
      return;
    }

    this.closeBoardMenu();
    this.boardPendingDelete.set(board);
    this.deleteBoardModalOpen.set(true);
  }

  cancelBoardDelete(): void {
    if (this.boardDeleting()) {
      return;
    }

    this.deleteBoardModalOpen.set(false);
    this.boardPendingDelete.set(null);
  }

  confirmBoardDelete(): void {
    const board = this.boardPendingDelete();

    if (!board || this.boardDeleting()) {
      return;
    }

    this.boardDeleting.set(true);

    this.boardService.deleteBoard(board.id).subscribe({
      next: () => {
        const remainingBoards = this.boards().filter((item) => item.id !== board.id);

        this.boards.set(remainingBoards);

        this.deleteBoardModalOpen.set(false);
        this.boardPendingDelete.set(null);
        this.boardDeleting.set(false);

        this.resetActiveBoardState();

        if (remainingBoards.length > 0) {
          this.selectBoard(remainingBoards[0]);
        }
      },
      error: (error) => {
        console.error('Не удалось удалить доску', error);
        this.boardDeleting.set(false);
      },
    });
  }

  saveColumnNote(columnId: string, note: string): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    this.boardService.updateColumn(boardId, columnId, { note }).subscribe({
      next: ({ column }) => {
        this.columns.update((columns) =>
          columns.map((item) =>
            item.id === columnId ? { ...item, note: column.note ?? '' } : item,
          ),
        );
      },
      error: (error) => {
        console.error('Не удалось сохранить заметку колонки:', error);
      },
    });
  }

  isActiveBoardOwner(): boolean {
    const boardId = this.activeBoardId();
    const currentUserId = this.authService.user()?.id;

    if (!boardId || !currentUserId) {
      return false;
    }

    return this.boards().some((board) => board.id === boardId && board.ownerId === currentUserId);
  }

  openShareModal(): void {
    if (!this.activeBoardId()) {
      return;
    }

    this.closeBoardMenu();
    this.shareModalOpen.set(true);

    this.inviteEmail.set('');
    this.invitationError.set('');
    this.invitationSuccess.set('');

    this.loadBoardMembers();
    this.loadIncomingInvitations();
  }

  closeShareModal(): void {
    this.shareModalOpen.set(false);
    this.invitationError.set('');
    this.invitationSuccess.set('');

    if (this.invitationErrorTimer) {
      clearTimeout(this.invitationErrorTimer);
      this.invitationErrorTimer = null;
    }

    if (this.invitationSuccessTimer) {
      clearTimeout(this.invitationSuccessTimer);
      this.invitationSuccessTimer = null;
    }
  }

  loadBoardMembers(): void {
    const boardId = this.activeBoardId();

    if (!boardId) {
      return;
    }

    this.boardMembersLoading.set(true);

    this.boardService.getBoard(boardId).subscribe({
      next: ({ board }) => {
        if (this.activeBoardId() !== boardId) {
          return;
        }

        this.boardOwner.set(board.owner ?? null);
        this.boardMembers.set(board.members ?? []);
        this.boardMembersLoading.set(false);
      },
      error: (error) => {
        console.error('Не удалось загрузить участников доски', error);

        if (this.activeBoardId() === boardId) {
          this.boardMembersLoading.set(false);
        }
      },
    });
  }

  sendInvitation(): void {
    const boardId = this.activeBoardId();
    const email = this.inviteEmail().trim();

    if (!boardId || !email || this.invitationSending() || !this.isActiveBoardOwner()) {
      return;
    }

    this.invitationSending.set(true);
    this.invitationError.set('');
    this.invitationSuccess.set('');

    this.boardService.createInvitation(boardId, email).subscribe({
      next: (response) => {
        this.showInvitationSuccess('Приглашение отправлено.');

        this.inviteEmail.set('');
        this.invitationSending.set(false);
      },
      error: (error) => {
        this.showInvitationError(error?.error?.message || 'Не удалось отправить приглашение.');

        this.invitationSending.set(false);
      },
    });
  }

  loadIncomingInvitations(): void {
    this.invitationsLoading.set(true);
    this.incomingInvitationsError.set('');

    this.boardService.getIncomingInvitations().subscribe({
      next: ({ invitations }) => {
        this.incomingInvitations.set(invitations);
        this.invitationsLoading.set(false);
      },
      error: (error) => {
        console.error('Не удалось загрузить приглашения', error);

        this.incomingInvitationsError.set(
          error?.error?.message || 'Не удалось загрузить приглашения.',
        );

        this.invitationsLoading.set(false);
      },
    });
  }

  respondToInvitation(invitation: InvitationType, action: InvitationAction): void {
    if (this.respondingInvitationId()) {
      return;
    }

    this.respondingInvitationId.set(invitation.id);
    this.incomingInvitationsError.set('');

    this.boardService.respondToInvitation(invitation.id, action).subscribe({
      next: () => {
        this.incomingInvitations.update((items) =>
          items.filter((item) => item.id !== invitation.id),
        );

        this.respondingInvitationId.set(null);

        if (action === 'accept') {
          this.refreshBoardsList();
        }
      },
      error: (error) => {
        console.error('Не удалось обработать приглашение', error);

        this.incomingInvitationsError.set(
          error?.error?.message || 'Не удалось обработать приглашение.',
        );

        this.respondingInvitationId.set(null);
      },
    });
  }

  removeBoardMember(memberUserId: string, memberName: string): void {
    if (!this.activeBoardId() || !this.isActiveBoardOwner() || this.memberActionId()) {
      return;
    }

    this.memberActionError.set('');
    this.memberToRemove.set({
      userId: memberUserId,
      name: memberName,
    });
  }

  cancelMemberRemoval(): void {
    if (this.memberActionId()) {
      return;
    }

    this.memberToRemove.set(null);
    this.memberActionError.set('');
  }

  confirmMemberRemoval(): void {
    const member = this.memberToRemove();
    const boardId = this.activeBoardId();

    if (!member || !boardId || !this.isActiveBoardOwner() || this.memberActionId()) {
      return;
    }

    this.memberActionId.set(member.userId);
    this.memberActionError.set('');
    this.memberActionSuccess.set('');

    this.boardService.removeBoardMember(boardId, member.userId).subscribe({
      next: () => {
        this.boardMembers.update((members) =>
          members.filter((item) => item.userId !== member.userId),
        );

        this.showMemberActionSuccess(`Участник ${member.name} удалён с доски.`);

        this.memberToRemove.set(null);
        this.memberActionId.set(null);

        this.refreshBoardsList();
      },
      error: (error) => {
        this.memberActionError.set(
          error?.error?.message || 'Не удалось удалить участника. Попробуйте ещё раз.',
        );

        this.memberActionId.set(null);
      },
    });
  }

  leaveBoard(): void {
    if (!this.activeBoardId() || this.isActiveBoardOwner() || this.boardLeaving()) {
      return;
    }

    this.leaveBoardTitle.set(this.boardTitle());
    this.leaveBoardError.set('');
    this.closeShareModal();
    this.leaveBoardModalOpen.set(true);
  }

  cancelLeaveBoard(): void {
    if (this.boardLeaving()) {
      return;
    }

    this.leaveBoardModalOpen.set(false);
    this.leaveBoardError.set('');
  }

  confirmLeaveBoard(): void {
    const boardId = this.activeBoardId();
    const boardTitle = this.leaveBoardTitle();

    if (!boardId || this.isActiveBoardOwner() || this.boardLeaving()) {
      return;
    }

    this.boardLeaving.set(true);
    this.leaveBoardError.set('');

    this.boardService.leaveBoard(boardId).subscribe({
      next: () => {
        this.boardLeaving.set(false);
        this.leaveBoardModalOpen.set(false);

        this.handleAccessRevoked({
          boardId,
          boardTitle,
          reason: 'left',
        });
      },
      error: (error) => {
        console.error('Не удалось покинуть доску', error);

        this.leaveBoardError.set(
          error?.error?.message || 'Не удалось покинуть доску. Попробуйте ещё раз.',
        );

        this.boardLeaving.set(false);
      },
    });
  }

  private showInvitationSuccess(message: string): void {
    if (this.invitationSuccessTimer) {
      clearTimeout(this.invitationSuccessTimer);
    }

    this.invitationSuccess.set(message);

    this.invitationSuccessTimer = setTimeout(() => {
      this.invitationSuccess.set('');
      this.invitationSuccessTimer = null;
    }, 2000);
  }

  private showMemberActionSuccess(message: string): void {
    if (this.memberActionSuccessTimer) {
      clearTimeout(this.memberActionSuccessTimer);
    }

    this.memberActionSuccess.set(message);

    this.memberActionSuccessTimer = setTimeout(() => {
      this.memberActionSuccess.set('');
      this.memberActionSuccessTimer = null;
    }, 2000);
  }

  private showInvitationError(message: string): void {
    if (this.invitationErrorTimer) {
      clearTimeout(this.invitationErrorTimer);
    }

    this.invitationError.set(message);

    this.invitationErrorTimer = setTimeout(() => {
      this.invitationError.set('');
      this.invitationErrorTimer = null;
    }, 2000);
  }

  private resetActiveBoardState(): void {
    this.boardSelectionRequestId++;

    this.cardDeletionService.cancelAll();
    this.pendingDeletions.set([]);

    for (const cardId of [...this.editingBoardByCard.keys()]) {
      this.stopCardEditing(cardId);
    }

    this.editingBoardByCard.clear();
    this.editingCards.set({});
    this.editingCardConflict.set(null);

    this.activeBoardId.set(null);
    this.columns.set([]);
    this.highlightedCardId.set(null);
    this.boardOwner.set(null);
    this.boardMembers.set([]);
    this.boardMembersLoading.set(false);

    this.boardTitle.set('Моя доска');
    this.boardDescription.set('');
    this.boardTitleDraft.set('');
    this.boardDescriptionDraft.set('');
    this.editingBoardTitle.set(false);
    this.editingBoardDescription.set(false);
    this.cardSaveError.set('');
    this.memberActionId.set(null);
    this.memberActionError.set('');
    this.memberActionSuccess.set('');
    this.memberToRemove.set(null);

    if (this.memberActionSuccessTimer) {
      clearTimeout(this.memberActionSuccessTimer);
      this.memberActionSuccessTimer = null;
    }

    this.closeCardForm();
    this.closeBoardsMenu();
    this.closeBoardMenu();
    this.closeShareModal();
    this.cancelColumnDelete();

    this.inviteEmail.set('');
    this.invitationSending.set(false);

    this.leaveBoardModalOpen.set(false);
    this.boardLeaving.set(false);
    this.leaveBoardError.set('');
    this.leaveBoardTitle.set('');
  }

  ngOnDestroy(): void {
    this.realtimeMessageSubscription?.unsubscribe();
    this.realtimeConnectedSubscription?.unsubscribe();

    this.realtimeService.disconnect();

    this.cardDeletionService.cancelAll();
    if (this.invitationSuccessTimer) {
      clearTimeout(this.invitationSuccessTimer);
    }

    if (this.invitationErrorTimer) {
      clearTimeout(this.invitationErrorTimer);
    }

    if (this.memberActionSuccessTimer) {
      clearTimeout(this.memberActionSuccessTimer);
    }
  }
}
