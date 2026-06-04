import { Injectable, computed, signal } from '@angular/core';
import { getEnvOptional } from '../util/env';
import {
  AppDataResponse,
  ConfigResponse,
  PersonalAuthState,
  PersonalStatusResponse,
  PersonalTimeEntry,
  PersonalUser,
  Vision,
} from './personal-api.model';
import { AppStateSnapshot } from '../op-log/core/types/backup.types';
import { GlobalConfigState } from '../features/config/global-config.model';

@Injectable({ providedIn: 'root' })
export class PersonalApiService {
  readonly baseUrl = (
    getEnvOptional('PERSONAL_API_BASE_URL') || 'http://127.0.0.1:4280'
  ).replace(/\/$/, '');

  readonly authState = signal<PersonalAuthState>('checking');
  readonly user = signal<PersonalUser | null>(null);
  readonly isAvailable = computed(() => this.authState() !== 'unavailable');
  readonly isChecking = computed(() => this.authState() === 'checking');
  readonly isLoginRequired = computed(() => this.authState() === 'loginRequired');
  readonly isAuthenticated = computed(() => this.authState() === 'authenticated');

  constructor() {
    void this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    try {
      const status = await this._request<PersonalStatusResponse>('/status', {
        method: 'GET',
      });
      this.user.set(status.user);
      this.authState.set(status.authenticated ? 'authenticated' : 'loginRequired');
    } catch {
      this.user.set(null);
      this.authState.set('unavailable');
    }
  }

  async login(username: string, password: string): Promise<void> {
    const result = await this._request<{ user: PersonalUser }>('/login', {
      method: 'POST',
      body: { username, password },
    });
    this.user.set(result.user);
    this.authState.set('authenticated');
  }

  async logout(): Promise<void> {
    await this._request('/logout', { method: 'POST' });
    this.user.set(null);
    this.authState.set('loginRequired');
  }

  async getAppData(): Promise<AppDataResponse> {
    return this._request<AppDataResponse>('/app-data', { method: 'GET' });
  }

  async saveAppData(data: AppStateSnapshot): Promise<void> {
    await this._request('/app-data', {
      method: 'PUT',
      body: { data },
    });
  }

  async getConfig(): Promise<ConfigResponse> {
    return this._request<ConfigResponse>('/config', { method: 'GET' });
  }

  async saveConfig(config: GlobalConfigState): Promise<void> {
    await this._request('/config', {
      method: 'PUT',
      body: { config },
    });
  }

  async listVisions(): Promise<Vision[]> {
    const result = await this._request<{ visions: Vision[] }>('/visions', {
      method: 'GET',
    });
    return result.visions;
  }

  async createVision(input: Partial<Vision>): Promise<Vision> {
    const result = await this._request<{ vision: Vision }>('/visions', {
      method: 'POST',
      body: input,
    });
    return result.vision;
  }

  async updateVision(id: string, input: Partial<Vision>): Promise<Vision> {
    const result = await this._request<{ vision: Vision }>(`/visions/${id}`, {
      method: 'PUT',
      body: input,
    });
    return result.vision;
  }

  async deleteVision(id: string): Promise<void> {
    await this._request(`/visions/${id}`, { method: 'DELETE' });
  }

  async listTimeEntries(): Promise<PersonalTimeEntry[]> {
    const result = await this._request<{ entries: PersonalTimeEntry[] }>(
      '/time-entries',
      {
        method: 'GET',
      },
    );
    return result.entries;
  }

  async createTimeEntry(input: Partial<PersonalTimeEntry>): Promise<PersonalTimeEntry> {
    const result = await this._request<{ entry: PersonalTimeEntry }>('/time-entries', {
      method: 'POST',
      body: input,
    });
    return result.entry;
  }

  async updateTimeEntry(
    id: string,
    input: Partial<PersonalTimeEntry>,
  ): Promise<PersonalTimeEntry> {
    const result = await this._request<{ entry: PersonalTimeEntry }>(
      `/time-entries/${id}`,
      {
        method: 'PUT',
        body: input,
      },
    );
    return result.entry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this._request(`/time-entries/${id}`, { method: 'DELETE' });
  }

  async batchUpdateTimeEntries(
    ids: string[],
    changes: Partial<PersonalTimeEntry>,
  ): Promise<void> {
    await this._request('/time-entries/batch', {
      method: 'PATCH',
      body: { ids, changes },
    });
  }

  async batchDeleteTimeEntries(ids: string[]): Promise<void> {
    await this._request('/time-entries/batch', {
      method: 'PATCH',
      body: { ids, delete: true },
    });
  }

  private async _request<T = unknown>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
    },
  ): Promise<T> {
    const headers = new Headers();
    if (options.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}/api/personal${path}`, {
      method: options.method,
      credentials: 'include',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error || `Personal server request failed: ${response.status}`,
      );
    }

    return response.json() as Promise<T>;
  }
}
