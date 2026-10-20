import { KanbanColumnType } from '../types/KanbanColumnType';
import { KanbanCardType } from '../types/KanbanCardType';

export function appendCardToColumn(
  columns: KanbanColumnType[],
  columnId: string,
  card: KanbanCardType,
): KanbanColumnType[] {
  return columns.map((column) =>
    column.id === columnId ? { ...column, cards: [...column.cards, card] } : column,
  );
}

export function removeCardFromColumn(
  columns: KanbanColumnType[],
  columnId: string,
  cardId: string,
): KanbanColumnType[] {
  return columns.map((column) =>
    column.id === columnId
      ? {
          ...column,
          cards: column.cards.filter((card) => card.id !== cardId),
        }
      : column,
  );
}

export function updateCardInColumns(
  columns: KanbanColumnType[],
  columnId: string,
  cardId: string,
  update: (card: KanbanCardType) => KanbanCardType,
): KanbanColumnType[] {
  return columns.map((column) =>
    column.id === columnId
      ? {
        ...column,
        cards: column.cards.map((card) =>
          card.id === cardId ? update(card) : card,
        ),
      }
      : column,
  );
}
