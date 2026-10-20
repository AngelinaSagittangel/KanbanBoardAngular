
export type InvitationType = {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt: string;
  respondedAt: string | null;
  board: {
    id: string;
    title: string;
    description?: string | null;
  };
  invitedBy: {
    id: string;
    name: string;
    email?: string;
  };
};

export type InvitationsResponse = {
  invitations: InvitationType[];
};

export type InvitationAction = 'accept' | 'decline';

export type InvitationResponse = {
  message: string;
  invitation?: InvitationType;
};

export type CreateInvitationResponse = {
  message: string;
  invitation: InvitationType;
};
