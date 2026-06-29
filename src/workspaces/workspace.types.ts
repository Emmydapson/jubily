import type { Request } from 'express';

export type AuthenticatedUser = {
  adminId?: string;
  userId?: string;
  email: string;
  role: string;
  kind?: 'admin' | 'user';
  emailVerified?: boolean;
  emailVerifiedAt?: Date | string | null;
};

export type WorkspaceRequest = Request & {
  user: AuthenticatedUser;
  workspace?: {
    id: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
  };
};
