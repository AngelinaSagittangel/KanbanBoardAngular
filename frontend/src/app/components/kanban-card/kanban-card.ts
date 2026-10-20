import { Component, computed, input, output, signal } from '@angular/core';
import type { ChecklistItemType, KanbanCardType } from '../../../types/KanbanCardType';
import { formatDueDate, isDueDateOverdue } from '../../../utils/date-utils';

@Component({
  selector: 'app-kanban-card',
  imports: [],
  templateUrl: './kanban-card.html',
  styleUrl: './kanban-card.scss',
})
export class KanbanCard {
  card = input.required<KanbanCardType>();
  isEditing = input(false);

  completionChange = output<string>();
  editRequest = output<KanbanCardType>();
  deleteRequest = output<string>();

  checklistChange = output<{
    cardId: string;
    checklist: ChecklistItemType[];
  }>();

  isExpanded = signal(true);

  checklist = computed(() => this.card().checklist ?? []);

  completedChecklistCount = computed(
    () => this.checklist().filter((item) => item.completed).length,
  );

  checklistProgress = computed(() => {
    const items = this.checklist();

    return items.length ? Math.round((this.completedChecklistCount() / items.length) * 100) : 0;
  });

  hasExtraInfo = computed(() => {
    const card = this.card();

    return !!(
      card.description?.trim() ||
      card.dueDate ||
      card.label?.trim() ||
      card.assignee?.name?.trim() ||
      this.checklist().length
    );
  });

  formattedDueDate(): string {
    const dueDate = this.card().dueDate;
    return dueDate ? formatDueDate(dueDate) : '';
  }

  assigneeInitial(): string {
    return this.card().assignee?.name?.trim().charAt(0).toUpperCase() ?? '';
  }

  isOverdue(): boolean {
    const card = this.card();

    return !card.completed && !!card.dueDate && isDueDateOverdue(card.dueDate);
  }

  toggleExpanded(): void {
    this.isExpanded.update((expanded) => !expanded);
  }

  toggleCompletion(): void {
    this.completionChange.emit(this.card().id);
  }

  toggleChecklistItem(itemId: string): void {
    const checklist = this.checklist().map((item) =>
      item.id === itemId ? { ...item, completed: !item.completed } : item,
    );

    this.checklistChange.emit({
      cardId: this.card().id,
      checklist,
    });
  }

  requestEdit(): void {
    this.editRequest.emit(this.card());
  }

  requestDelete(): void {
    this.deleteRequest.emit(this.card().id);
  }

  onDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.setData('text/plain', this.card().id);
    event.dataTransfer.effectAllowed = 'move';
  }
}
