import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface InvitationBoard {
  id: string;
  title: string;
  description?: string | null;
}

export interface InvitationUser {
  id: string;
  name: string;
  email?: string;
}

export interface BoardInvitation {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt: string;
  respondedAt?: string | null;
  boardId: string;
  recipientUserId?: string;
  invitedById?: string;
  board?: InvitationBoard;
  invitedBy?: InvitationUser;
}

export interface IncomingInvitationsResponse {
  invitations: BoardInvitation[];
}

export interface CreateInvitationResponse {
  message: string;
  invitation: BoardInvitation;
}

export interface InvitationResponse {
  message: string;
  invitation?: BoardInvitation;
}

@Injectable({
  providedIn: 'root',
})
export class InvitationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:3000/api/invitations';

  getIncoming(): Observable<IncomingInvitationsResponse> {
    return this.http.get<IncomingInvitationsResponse>(this.apiUrl);
  }

  inviteToBoard(boardId: string, email: string): Observable<CreateInvitationResponse> {
    return this.http.post<CreateInvitationResponse>(`${this.apiUrl}/boards/${boardId}`, { email });
  }

  respond(invitationId: string, action: 'accept' | 'decline'): Observable<InvitationResponse> {
    return this.http.patch<InvitationResponse>(`${this.apiUrl}/${invitationId}/respond`, {
      action,
    });
  }
}
