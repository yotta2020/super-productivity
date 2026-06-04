import { AppStateSnapshot } from '../op-log/core/types/backup.types';
import { GlobalConfigState } from '../features/config/global-config.model';

export type PersonalAuthState =
  | 'checking'
  | 'unavailable'
  | 'authenticated'
  | 'loginRequired';

export interface PersonalUser {
  id: number;
  username: string;
}

export interface PersonalStatusResponse {
  enabled: boolean;
  authenticated: boolean;
  user: PersonalUser | null;
}

export interface Vision {
  id: string;
  title: string;
  description: string;
  color: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PersonalTimeEntry {
  id: string;
  description: string;
  start: string;
  stop: string | null;
  durationMs: number;
  tagIds: string[];
  tags: string[];
  projectId: string | null;
  visionId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AppDataResponse {
  data: AppStateSnapshot | null;
  updatedAt: string | null;
}

export interface ConfigResponse {
  config: GlobalConfigState | null;
  updatedAt: string | null;
}
