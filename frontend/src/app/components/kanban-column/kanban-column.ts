import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  OnDestroy,
  effect,
} from '@angular/core';

import { ColumnColor } from '../../../types/ColumnColor';
import { ChecklistItemType, KanbanCardType } from '../../../types/KanbanCardType';
import { SortOption } from '../../../types/SortOption';
import { KanbanCard } from '../kanban-card/kanban-card';
import { ColumnDisplayItemType } from '../../../types/ColumnDisplayItemType';

@Component({
  selector: 'app-kanban-column',
  imports: [KanbanCard],
  templateUrl: './kanban-column.html',
  styleUrl: './kanban-column.scss',
})
export class KanbanColumn implements OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly MAX_COMMENT_LENGTH = 300;

  title = input.required<string>();
  color = input<ColumnColor>('blue');
  cards = input<KanbanCardType[]>([]);
  columnId = input.required<string>();
  highlightedCardId = input<string | null>(null);
  note = input<string | null>(null);

  titleChange = output<string>();
  colorChange = output<{ columnId: string; color: ColumnColor }>();
  columnDelete = output<string>();
  noteChange = output<string>();

  cardCompletionChange = output<string>();
  cardCreate = output<Omit<KanbanCardType, 'id'>>();
  cardUpdate = output<KanbanCardType>();
  cardDelete = output<string>();

  cardMove = output<{
    cardId: string;
    targetColumnId: string;
  }>();

  checklistChange = output<{
    cardId: string;
    checklist: ChecklistItemType[];
  }>();

  cancelDelete = output<string>();

  editingTitle = signal(false);
  draftTitle = signal('');

  sortBy = signal<SortOption>('default');
  isMenuOpen = signal(false);

  columnComment = signal('');
  commentDraft = signal('');
  editingComment = signal(false);

  isDragOver = signal(false);
  private dragEnterCounter = 0;

  pendingDeletions = input<
    {
      card: KanbanCardType;
      columnId: string;
      index: number;
    }[]
  >([]);

  remainingSeconds = signal<Partial<Record<string, number>>>({});

  private readonly countdownIntervals = new Map<string, ReturnType<typeof setInterval>>();

  private readonly knownDeletionIds = new Set<string>();

  cardFormRequested = output<{
    columnId: string;
    card?: KanbanCardType;
  }>();

  sortedCards = computed(() => {
    const cards = [...this.cards()];

    switch (this.sortBy()) {
      case 'name':
        return cards.sort((a, b) => a.title.localeCompare(b.title, 'ru'));

      case 'date':
        return cards.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

      default:
        return cards;
    }
  });

  displayItems = computed(() => {
    const items: ColumnDisplayItemType[] = this.cards().map((card) => ({
      type: 'card',
      card,
    }));

    const pending = this.pendingDeletions()
      .filter((item) => item.columnId === this.columnId())
      .sort((a, b) => b.index - a.index);

    for (const deletion of pending) {
      const index = Math.min(deletion.index, items.length);

      items.splice(index, 0, {
        type: 'pending',
        deletion,
      });
    }

    switch (this.sortBy()) {
      case 'name':
        return items.sort((a, b) =>
          this.getDisplayCard(a).title.localeCompare(this.getDisplayCard(b).title, 'ru'),
        );

      case 'date':
        return items.sort((a, b) => {
          const dateA = this.getDisplayCard(a).dueDate;
          const dateB = this.getDisplayCard(b).dueDate;

          if (!dateA && dateB) return 1;
          if (dateA && !dateB) return -1;
          if (!dateA || !dateB) return 0;

          return dateA.localeCompare(dateB);
        });

      default:
        return items;
    }
  });

  private highlightTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const cardId = this.highlightedCardId();
      const cards = this.cards();

      if (!cardId || !cards.some((card) => card.id === cardId)) {
        return;
      }

      requestAnimationFrame(() => {
        // Проверяем, что карточка всё ещё выбрана для подсветки.
        if (this.highlightedCardId() !== cardId) {
          return;
        }

        const cardElement = this.elementRef.nativeElement.querySelector(
          `[data-card-id="${CSS.escape(cardId)}"]`,
        ) as HTMLElement | null;

        if (!cardElement) {
          return;
        }

        cardElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });

        cardElement.classList.remove('kanban__card--search-highlight');

        void cardElement.offsetWidth;

        cardElement.classList.add('kanban__card--search-highlight');

        if (this.highlightTimer) {
          clearTimeout(this.highlightTimer);
        }

        this.highlightTimer = setTimeout(() => {
          cardElement.classList.remove('kanban__card--search-highlight');
          this.highlightTimer = undefined;
        }, 2500);
      });
    });

    effect(() => {
      this.pendingDeletions();
      this.syncDeletionCountdown();
    });

    effect(() => {
      const note = this.note() ?? '';

      if (!this.editingComment()) {
        this.columnComment.set(note);
        this.commentDraft.set(note);
      }
    });
  }

  openCardForm(): void {
    this.cardFormRequested.emit({
      columnId: this.columnId(),
    });
  }

  startEditingCard(card: KanbanCardType): void {
    this.cardFormRequested.emit({
      columnId: this.columnId(),
      card,
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    const clickedInsideColumn = this.elementRef.nativeElement.contains(target);

    if (!clickedInsideColumn) {
      if (this.editingTitle()) {
        this.saveTitle();
      }

      if (this.editingComment()) {
        this.saveComment();
      }

      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isMenuOpen()) {
      this.closeMenu();
    }

    if (this.editingTitle()) {
      this.cancelEditingTitle();
    }

    if (this.editingComment()) {
      this.cancelEditingComment();
    }
  }

  toggleMenu(): void {
    this.isMenuOpen.update((isOpen) => !isOpen);
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  renameFromMenu(): void {
    this.closeMenu();
    this.startEditingTitle();
  }

  changeColor(color: ColumnColor): void {
    this.colorChange.emit({
      columnId: this.columnId(),
      color,
    });

    this.closeMenu();
  }

  deleteFromMenu(): void {
    this.closeMenu();
    this.columnDelete.emit(this.columnId());
  }

  startEditingTitle(): void {
    this.draftTitle.set(this.title());
    this.editingTitle.set(true);
  }

  updateDraftTitle(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    this.draftTitle.set(inputElement.value.slice(0, 50));
  }

  saveTitle(): void {
    const newTitle = this.draftTitle().trim().slice(0, 50);

    if (newTitle && newTitle !== this.title()) {
      this.titleChange.emit(newTitle);
    }

    this.editingTitle.set(false);
  }

  cancelEditingTitle(): void {
    this.editingTitle.set(false);
  }

  startEditingComment(): void {
    this.commentDraft.set(this.columnComment());
    this.editingComment.set(true);
  }

  updateComment(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;

    this.commentDraft.set(textarea.value.slice(0, this.MAX_COMMENT_LENGTH));
  }

  saveComment(): void {
    const comment = this.commentDraft().trim().slice(0, this.MAX_COMMENT_LENGTH);

    this.commentDraft.set(comment);
    this.editingComment.set(false);

    if (comment !== (this.note() ?? '')) {
      this.noteChange.emit(comment);
    }
  }

  cancelEditingComment(): void {
    this.commentDraft.set(this.columnComment());
    this.editingComment.set(false);
  }

  updateSort(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    this.sortBy.set(selectElement.value as SortOption);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();

    const cardId = event.dataTransfer?.getData('text/plain');

    if (!cardId) {
      return;
    }

    this.cardMove.emit({
      cardId,
      targetColumnId: this.columnId(),
    });

    this.dragEnterCounter = 0;
    this.isDragOver.set(false);
  }

  onDragEnter(): void {
    this.dragEnterCounter++;
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.dragEnterCounter--;

    if (this.dragEnterCounter <= 0) {
      this.dragEnterCounter = 0;
      this.isDragOver.set(false);
    }
  }

  private getDisplayCard(item: ColumnDisplayItemType): KanbanCardType {
    return item.type === 'card' ? item.card : item.deletion.card;
  }

  private syncDeletionCountdown(): void {
    const currentIds = new Set(
      this.pendingDeletions()
        .filter((item) => item.columnId === this.columnId())
        .map((item) => item.card.id),
    );

    for (const id of currentIds) {
      if (this.knownDeletionIds.has(id)) {
        continue;
      }

      this.knownDeletionIds.add(id);

      this.remainingSeconds.update((seconds) => ({
        ...seconds,
        [id]: 5,
      }));

      const interval = setInterval(() => {
        const current = this.remainingSeconds()[id] ?? 0;

        if (current <= 1) {
          clearInterval(interval);
          this.countdownIntervals.delete(id);

          this.remainingSeconds.update((seconds) => {
            const next = { ...seconds };
            delete next[id];
            return next;
          });

          return;
        }

        this.remainingSeconds.update((seconds) => ({
          ...seconds,
          [id]: current - 1,
        }));
      }, 1000);

      this.countdownIntervals.set(id, interval);
    }

    for (const id of this.knownDeletionIds) {
      if (!currentIds.has(id)) {
        const interval = this.countdownIntervals.get(id);

        if (interval) {
          clearInterval(interval);
          this.countdownIntervals.delete(id);
        }

        this.knownDeletionIds.delete(id);

        this.remainingSeconds.update((seconds) => {
          const next = { ...seconds };
          delete next[id];
          return next;
        });
      }
    }
  }

  ngOnDestroy(): void {
    for (const interval of this.countdownIntervals.values()) {
      clearInterval(interval);
    }

    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
  }
}
