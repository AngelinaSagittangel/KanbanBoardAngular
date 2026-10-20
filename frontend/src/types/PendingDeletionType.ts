import { KanbanCardType } from './KanbanCardType';

export type PendingDeletionType = {
  card: KanbanCardType;
  columnId: string;
  index: number;
};
