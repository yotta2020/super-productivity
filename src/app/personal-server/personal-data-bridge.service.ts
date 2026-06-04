import { Injectable, effect, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged, take } from 'rxjs/operators';

import { DataInitStateService } from '../core/data-init/data-init-state.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { loadAllData } from '../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../op-log/model/model-config';
import { StateSnapshotService } from '../op-log/backup/state-snapshot.service';
import { distinctUntilChangedObject } from '../util/distinct-until-changed-object';
import { PersonalApiService } from './personal-api.service';

@Injectable({ providedIn: 'root' })
export class PersonalDataBridgeService {
  private readonly _api = inject(PersonalApiService);
  private readonly _store = inject(Store);
  private readonly _dataInitState = inject(DataInitStateService);
  private readonly _stateSnapshot = inject(StateSnapshotService);
  private readonly _globalConfig = inject(GlobalConfigService);
  private readonly _subs = new Subscription();
  private _activationPromise: Promise<void> | null = null;
  private _isSaveEnabled = false;

  readonly isLoadingServerData = signal(false);
  readonly lastSavedAt = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this._api.isAuthenticated()) {
        void this.activate();
      }
    });
  }

  async activate(): Promise<void> {
    if (this._activationPromise) {
      return this._activationPromise;
    }

    this._activationPromise = this._activateInner();
    return this._activationPromise;
  }

  private async _activateInner(): Promise<void> {
    this.isLoadingServerData.set(true);
    this.lastError.set(null);

    try {
      await firstValueFrom(this._dataInitState.isAllDataLoadedInitially$.pipe(take(1)));

      const remote = await this._api.getAppData();
      if (remote.data) {
        this._store.dispatch(
          loadAllData({ appDataComplete: remote.data as unknown as AppDataComplete }),
        );
      }

      this._isSaveEnabled = true;
      this._startSaving();

      if (!remote.data) {
        await this._saveCurrentSnapshot();
      }
    } catch (err) {
      this.lastError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isLoadingServerData.set(false);
    }
  }

  private _startSaving(): void {
    if (this._subs.closed) return;

    this._subs.add(
      this._globalConfig.cfg$
        .pipe(debounceTime(1000), distinctUntilChanged(distinctUntilChangedObject))
        .subscribe((cfg) => {
          if (!this._isSaveEnabled || !this._api.isAuthenticated()) return;
          void this._api.saveConfig(cfg).catch((err) => this._captureError(err));
        }),
    );

    this._subs.add(
      this._store.pipe(debounceTime(2500)).subscribe(() => {
        if (!this._isSaveEnabled || !this._api.isAuthenticated()) return;
        void this._saveCurrentSnapshot();
      }),
    );
  }

  private async _saveCurrentSnapshot(): Promise<void> {
    try {
      const snapshot = await this._stateSnapshot.getStateSnapshotAsync();
      await this._api.saveAppData(snapshot);
      this.lastSavedAt.set(new Date().toISOString());
      this.lastError.set(null);
    } catch (err) {
      this._captureError(err);
    }
  }

  private _captureError(err: unknown): void {
    this.lastError.set(err instanceof Error ? err.message : String(err));
  }
}
