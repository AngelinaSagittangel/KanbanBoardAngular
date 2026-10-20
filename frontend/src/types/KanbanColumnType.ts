import { ColumnColor } from './ColumnColor';
import { KanbanCardType } from './KanbanCardType';

export type KanbanColumnType = {
  id: string;
  title: string;
  color: ColumnColor;
  note: string | null;
  cards: KanbanCardType[];
};
