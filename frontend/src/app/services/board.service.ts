import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  BoardsResponse,
  BoardResponse,
  CreateBoardDto,
  UpdateBoardDto,
  BoardColumnResponse,
  BoardCardResponse,
} from '../../types/BoardType';
import { ChecklistItemType } from '../../types/KanbanCardType';
import { CardSearchResponse } from '../../types/CardSearchType';
import {
  CreateInvitationResponse,
  InvitationAction,
  InvitationsResponse,
} from '../../types/InvitationType';
import {
  CardActivityResponse,
  CardCommentResponse,
  CardCommentsResponse,
} from '../../types/CardActivityType';

export interface UpdateCardDto {
  expectedUpdatedAt: string;
  title?: string;
  description?: string | null;
  completed?: boolean;
  dueDate?: string | null;
  label?: string | null;
  labelColor?: string | null;
  checklist?: ChecklistItemType[] | null;
  assigneeId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:3000/api/boards';
  private readonly invitationsUrl = 'http://localhost:3000/api/invitations';
  private readonly realtimeUrl = 'http://localhost:3000/api/realtime';

  createWebSocketTicket(): Observable<{ ticket: string }> {
    return this.http.post<{ ticket: string }>(`${this.realtimeUrl}/ticket`, {});
  }

  getBoards(): Observable<BoardsResponse> {
    return this.http.get<BoardsResponse>(this.apiUrl);
  }

  getBoard(boardId: string): Observable<BoardResponse> {
    return this.http.get<BoardResponse>(`${this.apiUrl}/${boardId}`);
  }

  createBoard(data: CreateBoardDto): Observable<BoardResponse> {
    return this.http.post<BoardResponse>(this.apiUrl, data);
  }

  updateBoard(boardId: string, data: UpdateBoardDto): Observable<BoardResponse> {
    return this.http.patch<BoardResponse>(`${this.apiUrl}/${boardId}`, data);
  }

  deleteBoard(boardId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${boardId}`);
  }

  removeBoardMember(
    boardId: string,
    memberUserId: string,
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${boardId}/members/${memberUserId}`,
    );
  }

  leaveBoard(boardId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${boardId}/leave`,
    );
  }

  createColumn(boardId: string, title: string): Observable<{ column: BoardColumnResponse }> {
    return this.http.post<{ column: BoardColumnResponse }>(`${this.apiUrl}/${boardId}/columns`, {
      title,
    });
  }

  updateColumn(
    boardId: string,
    columnId: string,
    data: { title?: string; color?: string; note?: string | null },
  ): Observable<{ message: string; column: BoardColumnResponse }> {
    return this.http.patch<{
      message: string;
      column: BoardColumnResponse;
    }>(`${this.apiUrl}/${boardId}/columns/${columnId}`, data);
  }

  deleteColumn(boardId: string, columnId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${boardId}/columns/${columnId}`);
  }

  createCard(
    boardId: string,
    columnId: string,
    data: {
      title: string;
      description?: string | null;
      dueDate?: string | null;
      label?: string | null;
      labelColor?: string | null;
      checklist?: ChecklistItemType[] | null;
      assigneeId?: string | null;
    },
  ): Observable<{ card: BoardCardResponse }> {
    return this.http.post<{ card: BoardCardResponse }>(
      `${this.apiUrl}/${boardId}/columns/${columnId}/cards`,
      data,
    );
  }

  updateCard(
    boardId: string,
    columnId: string,
    cardId: string,
    data: UpdateCardDto,
  ): Observable<{ message: string; card: BoardCardResponse }> {
    return this.http.patch<{
      message: string;
      card: BoardCardResponse;
    }>(`${this.apiUrl}/${boardId}/columns/${columnId}/cards/${cardId}`, data);
  }

  moveCard(
    boardId: string,
    cardId: string,
    targetColumnId: string,
    order: number,
  ): Observable<{ message: string; card: BoardCardResponse }> {
    return this.http.patch<{ message: string; card: BoardCardResponse }>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/move`,
      { columnId: targetColumnId, order },
    );
  }

  searchCards(query: string, currentBoardId: string | null) {
    return this.http.get<CardSearchResponse>(`${this.apiUrl}/search`, {
      params: {
        q: query,
        ...(currentBoardId ? { currentBoardId } : {}),
      },
    });
  }

  deleteCard(boardId: string, columnId: string, cardId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${boardId}/columns/${columnId}/cards/${cardId}`,
    );
  }

  createInvitation(boardId: string, email: string): Observable<CreateInvitationResponse> {
    return this.http.post<CreateInvitationResponse>(`${this.invitationsUrl}/boards/${boardId}`, {
      email,
    });
  }

  getIncomingInvitations(): Observable<InvitationsResponse> {
    return this.http.get<InvitationsResponse>(this.invitationsUrl);
  }

  respondToInvitation(
    invitationId: string,
    action: InvitationAction,
  ): Observable<InvitationsResponse> {
    return this.http.patch<InvitationsResponse>(`${this.invitationsUrl}/${invitationId}/respond`, {
      action,
    });
  }

  getCardActivity(boardId: string, cardId: string): Observable<CardActivityResponse> {
    return this.http.get<CardActivityResponse>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/activity`,
    );
  }

  getCardComments(boardId: string, cardId: string): Observable<CardCommentsResponse> {
    return this.http.get<CardCommentsResponse>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/comments`,
    );
  }

  createCardComment(
    boardId: string,
    cardId: string,
    content: string,
  ): Observable<CardCommentResponse> {
    return this.http.post<CardCommentResponse>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/comments`,
      { content },
    );
  }

  updateCardComment(
    boardId: string,
    cardId: string,
    commentId: string,
    content: string,
  ): Observable<CardCommentResponse> {
    return this.http.patch<CardCommentResponse>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/comments/${commentId}`,
      { content },
    );
  }

  deleteCardComment(
    boardId: string,
    cardId: string,
    commentId: string,
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${boardId}/cards/${cardId}/comments/${commentId}`,
    );
  }
}
