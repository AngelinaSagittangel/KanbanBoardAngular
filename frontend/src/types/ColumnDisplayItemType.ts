import { KanbanCardType } from './KanbanCardType';

export type ColumnDisplayItemType =
  | {
      type: 'card';
      card: KanbanCardType;
    }
  | {
      type: 'pending';
      deletion: {
        card: KanbanCardType;
        columnId: string;
        index: number;
      };
    };
