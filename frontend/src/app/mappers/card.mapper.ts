import { KanbanCardType } from '../../types/KanbanCardType';

type ApiCard = {
  id: string;
  title: string;
  description?: string | null;
  completed: boolean;
  updatedAt: string;
  dueDate?: string | null;
  label?: string | null;
  labelColor?: string | null;
  checklist?: KanbanCardType['checklist'] | null;
  assigneeId?: string | null;
  assignee?: KanbanCardType['assignee'] | null;
};

export function mapApiCardToKanbanCard(card: ApiCard): KanbanCardType {
  return {
    id: card.id,
    title: card.title,
    description: card.description ?? '',
    completed: card.completed,
    updatedAt: card.updatedAt,
    checklist: card.checklist ?? [],
    dueDate: card.dueDate ?? undefined,
    label: card.label ?? undefined,
    assigneeId: card.assigneeId ?? null,
    assignee: card.assignee ?? null,
    labelColor:
      card.labelColor === 'purple' || card.labelColor === 'blue' || card.labelColor === 'green'
        ? card.labelColor
        : undefined,
  };
}
