import { KanbanColumnType } from '../../types/KanbanColumnType';
import { ColumnColor } from '../../types/ColumnColor';
import { mapApiCardToKanbanCard } from './card.mapper';
import { KanbanCardType } from '../../types/KanbanCardType';

type ApiCard = Parameters<typeof mapApiCardToKanbanCard>[0];

type ApiColumn = {
  id: string;
  title: string;
  color: string;
  note?: string | null;
  cards: ApiCard[];
};

const COLUMN_COLORS: ColumnColor[] = [
  'blue',
  'purple',
  'green',
  'yellow',
  'pink',
  'orange',
  'teal',
  'gray',
];

function mapColumnColor(color: string): ColumnColor {
  return COLUMN_COLORS.includes(color as ColumnColor) ? (color as ColumnColor) : 'gray';
}

export function mapApiColumnToKanbanColumn(column: ApiColumn): KanbanColumnType {
  return {
    id: column.id,
    title: column.title,
    color: mapColumnColor(column.color),
    note: column.note ?? '',
    cards: column.cards.map(mapApiCardToKanbanCard),
  };
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
          cards: column.cards.map((card) => (card.id === cardId ? update(card) : card)),
        }
      : column,
  );
}

export function moveCardBetweenColumns(
  columns: KanbanColumnType[],
  cardId: string,
  sourceColumnId: string,
  targetColumnId: string,
): KanbanColumnType[] {
  const sourceColumn = columns.find((column) => column.id === sourceColumnId);
  const targetColumn = columns.find((column) => column.id === targetColumnId);

  if (!sourceColumn || !targetColumn || sourceColumnId === targetColumnId) {
    return columns;
  }

  const card = sourceColumn.cards.find((item) => item.id === cardId);

  if (!card) {
    return columns;
  }

  return columns.map((column) => {
    if (column.id === sourceColumnId) {
      return {
        ...column,
        cards: column.cards.filter((item) => item.id !== cardId),
      };
    }

    if (column.id === targetColumnId) {
      return {
        ...column,
        cards: [...column.cards, card],
      };
    }

    return column;
  });
}
