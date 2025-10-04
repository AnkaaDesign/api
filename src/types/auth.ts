// Authentication response types

import type { User } from "./user";

export interface AuthTokenResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    user: AuthUser;
  };
}

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  status: string;
  requirePasswordChange?: boolean;
  verified?: boolean;
  sectorId?: string | null;
  managedSectorId?: string | null;
  sector?: {
    id: string;
    name: string;
    privileges: string;
  } | null;
  managedSector?: {
    id: string;
    name: string;
    privileges: string;
  } | null;
}

export interface AuthMessageResponse {
  success: boolean;
  message: string;
}

export interface AuthUserResponse {
  success: boolean;
  message: string;
  data: User;
}

export interface TokenPayload {
  sub: string; // user ID
  email: string | null;
  phone: string | null;
  name: string;
  iat: number;
  exp: number;
}
