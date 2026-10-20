export interface CardActivityType {
  id: string;
  boardId: string;
  cardId: string;
  actorId: string;
  actorName: string;
  type:
    | 'CARD_CREATED'
    | 'CARD_DELETED'
    | 'CARD_UPDATED'
    | 'CARD_MOVED'
    | 'CARD_COMPLETED'
    | 'CARD_ASSIGNED'
    | 'CARD_UNASSIGNED'
    | 'CHECKLIST_UPDATED'
    | 'COMMENT_ADDED'
    | 'COMMENT_UPDATED'
    | 'COMMENT_DELETED';
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface CardCommentType {
  id: string;
  content: string;
  cardId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string };
}

export interface CardActivityResponse {
  activities: CardActivityType[];
}

export interface CardCommentsResponse {
  comments: CardCommentType[];
}

export interface CardCommentResponse {
  message: string;
  comment: CardCommentType;
}
