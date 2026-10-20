import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ChecklistItemType, KanbanCardType } from '../../../types/KanbanCardType';
import { BoardMemberType } from '../../../types/BoardType';
import { formatDueDate } from '../../../utils/date-utils';
import { DatePipe } from '@angular/common';
import { BoardService } from '../../services/board.service';
import { AuthService } from '../../services/auth.service';
import { CardActivityType, CardCommentType } from '../../../types/CardActivityType';

@Component({
  selector: 'app-card-form-modal',
  imports: [DatePipe],
  templateUrl: './card-form-modal.html',
  styleUrl: './card-form-modal.scss',
})
export class CardFormModal {
  private readonly boardService = inject(BoardService);
  private readonly authService = inject(AuthService);

  boardId = input.required<string>();
  cards = input<KanbanCardType[]>([]);
  activityRefreshKey = input(0);
  columnId = input.required<string>();
  isOpen = input(false);
  editingCard = input<KanbanCardType | null>(null);
  saveError = input('');

  members = input<BoardMemberType[]>([]);
  owner = input<{ id: string; name: string } | null>(null);
  canAssign = input(false);

  editingUserId = input<string | null>(null);

  editingConflict = input<{
    cardId: string;
    userId: string;
  } | null>(null);
  editingUserName = input<string>('Другой участник');

  cardCreate = output<{
    columnId: string;
    card: Omit<KanbanCardType, 'id' | 'updatedAt'>;
  }>();

  cardUpdate = output<KanbanCardType>();
  modalClose = output<void>();

  cardEditingStart = output<string>();
  cardEditingStop = output<string>();

  isCreatingCard = signal(false);
  editingCardId = signal<string | null>(null);

  newCardTitle = signal('');
  newCardDescription = signal('');
  cardTitleError = signal('');
  newCardDueDate = signal('');
  newCardLabel = signal('');
  newCardLabelColor = signal<'purple' | 'blue' | 'green'>('purple');

  selectedAssigneeId = signal<string | null>(null);
  showLatestVersion = signal(true);

  isAssigneeEditorVisible = signal(false);
  assigneeSelectionChanged = signal(false);
  assigneeBeforeEditing = signal<string | null>(null);

  newCardChecklist = signal<ChecklistItemType[]>([]);
  newChecklistItemText = signal('');
  isChecklistEditorVisible = signal(false);

  readonly MAX_CHECKLIST_ITEMS = 20;

  activeTab = signal<'card' | 'comments' | 'activity'>('card');
  comments = signal<CardCommentType[]>([]);
  activities = signal<CardActivityType[]>([]);
  commentsLoading = signal(false);
  activityLoading = signal(false);
  commentsError = signal('');
  activityError = signal('');
  commentDraft = signal('');
  commentSaving = signal(false);
  editingCommentId = signal<string | null>(null);
  editingCommentDraft = signal('');
  commentActionId = signal<string | null>(null);
  commentToDeleteId = signal<string | null>(null);
  currentUserId = computed(() => this.authService.user()?.id ?? null);
  private lastActivityRefreshKey = 0;

  private activeEditingCardId: string | null = null;

  private syncEditingPresence(cardId: string | null): void {
    if (this.activeEditingCardId === cardId) {
      return;
    }

    if (this.activeEditingCardId) {
      this.cardEditingStop.emit(this.activeEditingCardId);
    }

    this.activeEditingCardId = cardId;

    if (cardId) {
      this.cardEditingStart.emit(cardId);
    }
  }
  private initializedCardId: string | null | undefined = undefined;
  private initialUpdatedAt: string | null = null;

  latestCard = computed(() => {
    const cardId = this.editingCardId();

    if (!cardId) {
      return null;
    }

    return this.cards().find((card) => card.id === cardId) ?? null;
  });

  hasRemoteChanges = computed(() => {
    const latest = this.latestCard();

    return (
      this.showLatestVersion() &&
      !!latest &&
      !!this.initialUpdatedAt &&
      latest.updatedAt !== this.initialUpdatedAt
    );
  });

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      const card = this.editingCard();

      if (!isOpen) {
        this.syncEditingPresence(null);
        this.isCreatingCard.set(false);
        this.initializedCardId = undefined;
        this.initialUpdatedAt = null;
        return;
      }

      const cardId = card?.id ?? null;

      if (this.initializedCardId === cardId) {
        return;
      }

      this.initializedCardId = cardId;
      this.initialUpdatedAt = card?.updatedAt ?? null;

      this.cardTitleError.set('');
      this.newChecklistItemText.set('');
      this.isAssigneeEditorVisible.set(false);
      this.assigneeSelectionChanged.set(false);

      if (card) {
        this.editingCardId.set(card.id);
        this.syncEditingPresence(card.id);
        this.newCardTitle.set(card.title);
        this.newCardDescription.set(card.description ?? '');
        this.newCardDueDate.set(card.dueDate ?? '');
        this.newCardLabel.set(card.label ?? '');

        const assigneeId =
          card.assigneeId !== undefined
            ? card.assigneeId
            : (card.assignee?.id ?? null);

        this.selectedAssigneeId.set(assigneeId);
        this.assigneeBeforeEditing.set(assigneeId);

        const labelColor = card.labelColor;

        this.newCardLabelColor.set(
          labelColor === 'purple' || labelColor === 'blue' || labelColor === 'green'
            ? labelColor
            : 'purple',
        );

        const checklist = (card.checklist ?? []).map((item) => ({
          ...item,
        }));

        this.newCardChecklist.set(checklist);
        this.isChecklistEditorVisible.set(checklist.length > 0);
      } else {
        this.editingCardId.set(null);
        this.resetCardForm();
        this.syncEditingPresence(null);
      }
    });

    effect(() => {
      const card = this.editingCard();

      if (
        !this.isOpen() ||
        !card ||
        this.isAssigneeEditorVisible() ||
        this.assigneeSelectionChanged()
      ) {
        return;
      }

      const assigneeId =
        card.assigneeId !== undefined
          ? card.assigneeId
          : (card.assignee?.id ?? null);
      const owner = this.owner();
      const members = this.members();

      if (assigneeId && !owner && members.length === 0) {
        return;
      }

      this.selectedAssigneeId.set(assigneeId);
      this.assigneeBeforeEditing.set(assigneeId);
    });

    effect(() => {
      const isOpen = this.isOpen();
      const card = this.editingCard();
      const refreshKey = this.activityRefreshKey();

      if (!isOpen || !card) {
        this.activeTab.set('card');
        this.comments.set([]);
        this.activities.set([]);
        this.lastActivityRefreshKey = refreshKey;
        return;
      }

      if (refreshKey !== this.lastActivityRefreshKey) {
        this.lastActivityRefreshKey = refreshKey;

        if (this.activeTab() === 'activity') {
          this.loadActivity();
        }
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      const cardId = this.editingCardId();
      const refreshKey = this.activityRefreshKey();

      if (!isOpen || !cardId) {
        this.comments.set([]);
        return;
      }

      void refreshKey;
      this.loadComments();
    });
  }

  selectTab(tab: 'card' | 'comments' | 'activity'): void {
    this.activeTab.set(tab);
    if (tab === 'comments') this.loadComments();
    if (tab === 'activity') this.loadActivity();
  }

  loadComments(): void {
    const boardId = this.boardId();
    const cardId = this.editingCardId();
    if (!boardId || !cardId) return;

    this.commentsLoading.set(true);
    this.commentsError.set('');
    this.boardService.getCardComments(boardId, cardId).subscribe({
      next: ({ comments }) => {
        this.comments.set(comments);
        this.commentsLoading.set(false);
      },
      error: (error) => {
        this.commentsLoading.set(false);
        this.commentsError.set(error?.error?.message ?? 'Не удалось загрузить комментарии.');
      },
    });
  }

  loadActivity(): void {
    const boardId = this.boardId();
    const cardId = this.editingCardId();
    if (!boardId || !cardId) return;

    this.activityLoading.set(true);
    this.activityError.set('');
    this.boardService.getCardActivity(boardId, cardId).subscribe({
      next: ({ activities }) => {
        this.activities.set(activities);
        this.activityLoading.set(false);
      },
      error: (error) => {
        this.activityLoading.set(false);
        this.activityError.set(error?.error?.message ?? 'Не удалось загрузить историю.');
      },
    });
  }

  addComment(): void {
    const content = this.commentDraft().trim();
    const boardId = this.boardId();
    const cardId = this.editingCardId();
    if (!content || !boardId || !cardId || this.commentSaving()) return;

    this.commentSaving.set(true);
    this.commentsError.set('');
    this.boardService.createCardComment(boardId, cardId, content).subscribe({
      next: ({ comment }) => {
        this.comments.update((items) => [...items, comment]);
        this.commentDraft.set('');
        this.commentSaving.set(false);
      },
      error: (error) => {
        this.commentsError.set(error?.error?.message ?? 'Не удалось добавить комментарий.');
        this.commentSaving.set(false);
      },
    });
  }

  startCommentEdit(comment: CardCommentType): void {
    this.editingCommentId.set(comment.id);
    this.editingCommentDraft.set(comment.content);
  }

  cancelCommentEdit(): void {
    this.editingCommentId.set(null);
    this.editingCommentDraft.set('');
  }

  saveCommentEdit(commentId: string): void {
    const content = this.editingCommentDraft().trim();
    const boardId = this.boardId();
    const cardId = this.editingCardId();
    if (!content || !boardId || !cardId || this.commentActionId()) return;

    this.commentActionId.set(commentId);
    this.commentsError.set('');
    this.boardService.updateCardComment(boardId, cardId, commentId, content).subscribe({
      next: ({ comment }) => {
        this.comments.update((items) =>
          items.map((item) => (item.id === comment.id ? comment : item)),
        );
        this.cancelCommentEdit();
        this.commentActionId.set(null);
      },
      error: (error) => {
        this.commentsError.set(error?.error?.message ?? 'Не удалось изменить комментарий.');
        this.commentActionId.set(null);
      },
    });
  }

  deleteComment(commentId: string): void {
    if (this.commentActionId()) return;

    this.commentToDeleteId.set(commentId);
  }

  cancelDeleteComment(): void {
    this.commentToDeleteId.set(null);
  }

  confirmDeleteComment(): void {
    const commentId = this.commentToDeleteId();
    const boardId = this.boardId();
    const cardId = this.editingCardId();

    if (!commentId || !boardId || !cardId || this.commentActionId()) {
      return;
    }

    this.commentActionId.set(commentId);
    this.commentsError.set('');

    this.boardService.deleteCardComment(boardId, cardId, commentId).subscribe({
      next: () => {
        this.comments.update((items) =>
          items.filter((item) => item.id !== commentId),
        );

        this.commentActionId.set(null);
        this.commentToDeleteId.set(null);
      },
      error: (error) => {
        this.commentsError.set(
          error?.error?.message ?? 'Не удалось удалить комментарий.',
        );

        this.commentActionId.set(null);
        this.commentToDeleteId.set(null);
      },
    });
  }

  activityDescription(activity: CardActivityType): string {
    const details = activity.details ?? {};

    const colorNames: Record<string, string> = {
      green: 'зелёный',
      blue: 'синий',
      purple: 'фиолетовый',
    };

    const formatValue = (value: unknown): string => {
      if (value === null || value === undefined || value === '') {
        return 'не указано';
      }

      if (typeof value === 'boolean') {
        return value ? 'выполнено' : 'не выполнено';
      }

      if (Array.isArray(value)) {
        return value.length
          ? value
              .map((item) => {
                if (typeof item === 'object' && item !== null && 'text' in item) {
                  const checklistItem = item as {
                    text: string;
                    completed?: boolean;
                  };

                  return `${checklistItem.text}${checklistItem.completed ? ' (выполнено)' : ''}`;
                }

                return String(item);
              })
              .join(', ')
          : 'пусто';
      }

      if (typeof value === 'object') {
        return JSON.stringify(value);
      }

      return String(value);
    };

    const fieldLabels: Record<string, string> = {
      title: 'название',
      description: 'описание',
      dueDate: 'срок выполнения',
      label: 'метку',
      labelColor: 'цвет метки',
      checklist: 'чек-лист',
      completed: 'статус выполнения',
      assigneeId: 'исполнителя',
    };

    const field = typeof details['field'] === 'string' ? details['field'] : '';

    const fieldLabel = fieldLabels[field] ?? field;
    const oldValue = details['oldValue'];
    const newValue = details['newValue'];

    const hasOldValue = Object.prototype.hasOwnProperty.call(details, 'oldValue');

    const hasNewValue = Object.prototype.hasOwnProperty.call(details, 'newValue');

    if (activity.type === 'CARD_UPDATED') {
      if (field === 'labelColor') {
        const oldColor =
          typeof oldValue === 'string' ? (colorNames[oldValue] ?? oldValue) : 'без цвета';

        const newColor =
          typeof newValue === 'string' ? (colorNames[newValue] ?? newValue) : 'без цвета';

        return `изменил(а) цвет метки: «${oldColor}» → «${newColor}»`;
      }

      if (field && hasOldValue && hasNewValue) {
        return `изменил(а) ${fieldLabel}: «${formatValue(oldValue)}» → «${formatValue(newValue)}»`;
      }

      return `изменил(а) карточку${fieldLabel ? `: ${fieldLabel}` : ''}`;
    }

    switch (activity.type) {
      case 'COMMENT_ADDED':
        return 'добавил(а) комментарий';

      case 'COMMENT_UPDATED':
        return 'изменил(а) комментарий';

      case 'COMMENT_DELETED':
        return 'удалил(а) комментарий';

      case 'CARD_CREATED':
        return 'создал(а) карточку';

      case 'CARD_DELETED':
        return 'удалил(а) карточку';

      case 'CARD_MOVED':
        return 'переместил(а) карточку';

      case 'CARD_COMPLETED':
        return `изменил(а) статус выполнения: «${formatValue(newValue)}»`;

      case 'CARD_ASSIGNED': {
        const assigneeName = details['assigneeName'];

        return typeof assigneeName === 'string' && assigneeName
          ? `назначил(а) исполнителя: ${assigneeName}`
          : 'назначил(а) исполнителя';
      }

      case 'CARD_UNASSIGNED': {
        const assigneeName = details['assigneeName'];

        return typeof assigneeName === 'string' && assigneeName
          ? `снял(а) исполнителя: ${assigneeName}`
          : 'снял(а) исполнителя';
      }

      case 'CHECKLIST_UPDATED':
        return 'обновил(а) чек-лист';

      default:
        return 'выполнил(а) действие';
    }
  }

  formatActivityDate(value: string): string {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  selectedAssigneeName(): string {
    const id = this.selectedAssigneeId();

    if (!id) {
      return '';
    }

    const owner = this.owner();

    if (owner?.id === id) {
      return owner.name;
    }

    const member = this.members().find((item) => item.userId === id);

    if (member) {
      return member.user.name;
    }

    const cardAssignee = this.editingCard()?.assignee;

    if (cardAssignee?.id === id) {
      return cardAssignee.name;
    }

    return 'Исполнитель';
  }

  startAssigneeEdit(): void {
    if (!this.canAssign()) {
      return;
    }

    this.assigneeBeforeEditing.set(this.selectedAssigneeId());
    this.isAssigneeEditorVisible.set(true);
  }

  finishAssigneeEdit(): void {
    this.assigneeBeforeEditing.set(this.selectedAssigneeId());
    this.assigneeSelectionChanged.set(true);
    this.isAssigneeEditorVisible.set(false);
  }

  cancelAssigneeEdit(): void {
    this.selectedAssigneeId.set(this.assigneeBeforeEditing());
    this.isAssigneeEditorVisible.set(false);
    this.assigneeSelectionChanged.set(false);
  }

  updateSelectedAssignee(event: Event): void {
    if (!this.canAssign()) {
      return;
    }

    const selectElement = event.target as HTMLSelectElement;
    this.selectedAssigneeId.set(selectElement.value || null);
  }

  saveCard(overwriteLatest = false): void {
    if (overwriteLatest) {
      this.showLatestVersion.set(false);
    }
    const title = this.newCardTitle().trim();

    if (!title) {
      this.cardTitleError.set('Введи название задачи');
      return;
    }

    const label = this.newCardLabel().trim();
    const description = this.newCardDescription().trim();
    const dueDate = this.newCardDueDate() || undefined;
    const editingCardId = this.editingCardId();

    const checklist = this.newCardChecklist()
      .filter((item) => item.text.trim().length > 0)
      .map((item) => ({
        ...item,
        text: item.text.trim().slice(0, 200),
      }));

    if (editingCardId) {
      const originalCard = this.editingCard();

      if (!originalCard || originalCard.id !== editingCardId) {
        return;
      }

      const latestCard = this.cards().find((card) => card.id === editingCardId);

      if (overwriteLatest && !latestCard) {
        return;
      }

      this.cardUpdate.emit({
        ...originalCard,
        updatedAt: overwriteLatest
          ? latestCard!.updatedAt
          : (this.initialUpdatedAt ?? originalCard.updatedAt),
        title,
        description,
        dueDate,
        label: label || undefined,
        labelColor: label ? this.newCardLabelColor() : undefined,
        checklist,
        assigneeId: this.canAssign()
          ? this.selectedAssigneeId()
          : (originalCard.assigneeId ?? null),
      });

      return;
    }

    this.cardCreate.emit({
      columnId: this.columnId(),
      card: {
        title,
        description,
        completed: false,
        checklist,
        assigneeId: this.canAssign() ? this.selectedAssigneeId() : null,
        ...(dueDate ? { dueDate } : {}),
        ...(label
          ? {
              label,
              labelColor: this.newCardLabelColor(),
            }
          : {}),
      },
    });
  }

  loadLatestVersion(): void {
    const card = this.latestCard();

    if (!card) {
      return;
    }

    this.showLatestVersion.set(false);

    this.initialUpdatedAt = card.updatedAt;

    this.newCardTitle.set(card.title);
    this.newCardDescription.set(card.description ?? '');
    this.newCardDueDate.set(card.dueDate ?? '');
    this.newCardLabel.set(card.label ?? '');

    this.newCardLabelColor.set(
      card.labelColor === 'purple' || card.labelColor === 'blue' || card.labelColor === 'green'
        ? card.labelColor
        : 'purple',
    );

    const assigneeId = card.assigneeId ?? card.assignee?.id ?? null;

    this.selectedAssigneeId.set(assigneeId);
    this.assigneeBeforeEditing.set(assigneeId);

    const checklist = (card.checklist ?? []).map((item) => ({
      ...item,
    }));

    this.newCardChecklist.set(checklist);
    this.isChecklistEditorVisible.set(checklist.length > 0);
    this.cardTitleError.set('');
  }

  cancelCardCreation(): void {
    this.isCreatingCard.set(false);
    this.editingCardId.set(null);
    this.resetCardForm();
    this.modalClose.emit();
    this.syncEditingPresence(null);
  }

  updateNewCardTitle(event: Event): void {
    const inputElement = event.target as HTMLInputElement;

    this.newCardTitle.set(inputElement.value.slice(0, 100));

    if (this.cardTitleError()) {
      this.cardTitleError.set('');
    }
  }

  updateNewCardDescription(event: Event): void {
    const textareaElement = event.target as HTMLTextAreaElement;
    this.newCardDescription.set(textareaElement.value.slice(0, 500));
  }

  updateNewCardDueDate(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    this.newCardDueDate.set(inputElement.value);
  }

  clearCardDueDate(): void {
    this.newCardDueDate.set('');
  }

  updateNewCardLabel(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    this.newCardLabel.set(inputElement.value.slice(0, 30));
  }

  updateNewCardLabelColor(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const color = selectElement.value;

    if (color === 'purple' || color === 'blue' || color === 'green') {
      this.newCardLabelColor.set(color);
    }
  }

  addChecklist(): void {
    this.isChecklistEditorVisible.set(true);
  }

  addChecklistItem(): void {
    if (this.newCardChecklist().length >= this.MAX_CHECKLIST_ITEMS) {
      return;
    }

    const text = this.newChecklistItemText().trim();

    if (!text) {
      return;
    }

    const item: ChecklistItemType = {
      id: crypto.randomUUID(),
      text: text.slice(0, 200),
      completed: false,
    };

    this.newCardChecklist.update((items) => {
      if (items.length >= this.MAX_CHECKLIST_ITEMS) {
        return items;
      }

      return [...items, item];
    });

    this.newChecklistItemText.set('');
  }

  updateChecklistItemText(itemId: string, event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const text = inputElement.value.slice(0, 200);

    this.newCardChecklist.update((items) =>
      items.map((item) => (item.id === itemId ? { ...item, text } : item)),
    );
  }

  toggleChecklistItemInForm(itemId: string, event: Event): void {
    const inputElement = event.target as HTMLInputElement;

    this.newCardChecklist.update((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, completed: inputElement.checked } : item,
      ),
    );
  }

  removeChecklistItem(itemId: string): void {
    this.newCardChecklist.update((items) => items.filter((item) => item.id !== itemId));
  }

  updateNewChecklistItemText(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    this.newChecklistItemText.set(inputElement.value.slice(0, 200));
  }

  handleChecklistEnter(event: Event): void {
    event.preventDefault();
    this.addChecklistItem();
  }

  completedChecklistCount(): number {
    return this.newCardChecklist().filter((item) => item.completed).length;
  }

  private resetCardForm(): void {
    this.newCardTitle.set('');
    this.newCardDescription.set('');
    this.newCardDueDate.set('');
    this.newCardLabel.set('');
    this.newCardLabelColor.set('purple');
    this.selectedAssigneeId.set(null);
    this.assigneeBeforeEditing.set(null);
    this.isAssigneeEditorVisible.set(false);
    this.cardTitleError.set('');
    this.newCardChecklist.set([]);
    this.newChecklistItemText.set('');
    this.isChecklistEditorVisible.set(false);
    this.assigneeSelectionChanged.set(false);
  }

  protected readonly formatDueDate = formatDueDate;
}
