import { ChecklistItemType } from './KanbanCardType';

export type BoardMemberType = {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export type BoardType = {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  owner?: {
    id: string;
    name: string;
  };
};

export type BoardMemberResponse = {
  userId: string;
  role: string;
  joinedAt: string;
  user: BoardMemberType;
};

export interface BoardCardResponse {
  id: string;
  title: string;
  description: string | null;
  order: number;
  completed: boolean;
  dueDate: string | null;
  label: string | null;
  labelColor: string | null;
  checklist: ChecklistItemType[] | null;
  assigneeId?: string | null;
  assignee?: {
    id: string;
    name: string;
  } | null;
  updatedAt: string;
}

export interface BoardColumnResponse {
  id: string;
  title: string;
  order: number;
  color: string;
  note: string | null;
  cards: BoardCardResponse[];
}

export type BoardsResponse = {
  boards: BoardType[];
};

export type BoardResponse = {
  board: BoardType & {
    columns: BoardColumnResponse[];
    members?: BoardMemberType[];
  };
};

export type CreateBoardDto = {
  title: string;
  description?: string | null;
};

export type UpdateBoardDto = {
  title?: string;
  description?: string | null;
};
