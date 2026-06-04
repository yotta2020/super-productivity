import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { Project } from '../../features/project/project.model';
import { selectAllProjectsExceptInbox } from '../../features/project/store/project.selectors';
import { PersonalApiService } from '../../personal-server/personal-api.service';
import { PersonalTimeEntry, Vision } from '../../personal-server/personal-api.model';

@Component({
  selector: 'time-entry-manager-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="time-page">
      <header>
        <div>
          <h1>时间记录</h1>
        </div>
        <button
          type="button"
          class="primary"
          [disabled]="!api.isAuthenticated()"
          (click)="createEntry()"
        >
          + 新增时间
        </button>
      </header>

      @if (api.isAuthenticated()) {
        <section class="new-entry">
          <label>
            描述
            <input [(ngModel)]="newDescription" />
          </label>
          <label>
            日期
            <input
              type="date"
              [(ngModel)]="newDate"
            />
          </label>
          <label>
            开始
            <input
              type="time"
              [(ngModel)]="newTime"
            />
          </label>
          <label>
            分钟
            <input
              type="number"
              min="1"
              step="1"
              [(ngModel)]="newDurationMinutes"
            />
          </label>
          <label>
            项目
            <select [(ngModel)]="newProjectId">
              <option value="">未分配</option>
              @for (project of projects(); track project.id) {
                <option [value]="project.id">{{ project.title }}</option>
              }
            </select>
          </label>
          <label>
            愿景
            <select [(ngModel)]="newVisionId">
              <option value="">未分配</option>
              @for (vision of visions(); track vision.id) {
                <option [value]="vision.id">{{ vision.title }}</option>
              }
            </select>
          </label>
          <label>
            标签
            <input
              placeholder="逗号分隔"
              [(ngModel)]="newTags"
            />
          </label>
        </section>

        <section class="batch-bar">
          <span>{{ selectedIds().length }} 条已选</span>
          <select [(ngModel)]="batchProjectId">
            <option value="">批量项目</option>
            @for (project of projects(); track project.id) {
              <option [value]="project.id">{{ project.title }}</option>
            }
          </select>
          <select [(ngModel)]="batchVisionId">
            <option value="">批量愿景</option>
            @for (vision of visions(); track vision.id) {
              <option [value]="vision.id">{{ vision.title }}</option>
            }
          </select>
          <input
            placeholder="批量标签，逗号分隔"
            [(ngModel)]="batchTags"
          />
          <button
            type="button"
            [disabled]="selectedIds().length === 0"
            (click)="applyBatch()"
          >
            应用
          </button>
          <button
            type="button"
            class="danger"
            [disabled]="selectedIds().length === 0"
            (click)="deleteSelected()"
          >
            批量删除
          </button>
        </section>

        <section class="entry-table">
          <div class="table-head">
            <span></span>
            <span>描述</span>
            <span>开始</span>
            <span>分钟</span>
            <span>项目</span>
            <span>愿景</span>
            <span>标签</span>
            <span></span>
          </div>

          @for (entry of entries(); track entry.id) {
            <div class="table-row">
              <input
                type="checkbox"
                [checked]="selected()[entry.id]"
                (change)="toggleSelected(entry.id, $any($event.target).checked)"
              />
              <input
                [ngModel]="entry.description"
                (ngModelChange)="patchEntry(entry.id, { description: $event })"
              />
              <input
                type="datetime-local"
                [ngModel]="toDateTimeLocal(entry.start)"
                (ngModelChange)="setEntryStart(entry.id, $event)"
              />
              <input
                type="number"
                min="0"
                step="1"
                [ngModel]="durationMinutes(entry)"
                (ngModelChange)="setEntryDuration(entry.id, $event)"
              />
              <select
                [ngModel]="entry.projectId || ''"
                (ngModelChange)="patchEntry(entry.id, { projectId: $event || null })"
              >
                <option value="">未分配</option>
                @for (project of projects(); track project.id) {
                  <option [value]="project.id">{{ project.title }}</option>
                }
              </select>
              <select
                [ngModel]="entry.visionId || ''"
                (ngModelChange)="patchEntry(entry.id, { visionId: $event || null })"
              >
                <option value="">未分配</option>
                @for (vision of visions(); track vision.id) {
                  <option [value]="vision.id">{{ vision.title }}</option>
                }
              </select>
              <input
                [ngModel]="entry.tags.join(', ')"
                (ngModelChange)="setEntryTags(entry.id, $event)"
              />
              <div class="row-actions">
                <button
                  type="button"
                  (click)="saveEntry(entry)"
                >
                  保存
                </button>
                <button
                  type="button"
                  class="danger"
                  (click)="deleteEntry(entry)"
                >
                  删除
                </button>
              </div>
            </div>
          } @empty {
            <div class="empty">还没有时间条目。</div>
          }
        </section>
      } @else {
        <section class="server-required">
          个人服务器未登录。时间记录管理需要服务器本地 SQLite。
        </section>
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: auto;
      }

      .time-page {
        padding: 20px 24px 32px;
        max-width: 1360px;
        margin: 0 auto;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 4px;
        font-size: 24px;
      }

      button,
      input,
      select {
        font: inherit;
      }

      button {
        height: 32px;
        border: 1px solid var(--extra-border-color);
        border-radius: 6px;
        padding: 0 10px;
        background: var(--card-bg);
        color: var(--text-color);
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .primary {
        height: 36px;
        padding: 0 14px;
        background: var(--c-accent);
        border-color: var(--c-accent);
        color: white;
      }

      .danger {
        color: #b00020;
      }

      .new-entry,
      .batch-bar,
      .entry-table,
      .server-required {
        border: 1px solid var(--extra-border-color);
        border-radius: 8px;
        background: var(--card-bg);
      }

      .new-entry {
        display: grid;
        grid-template-columns:
          minmax(220px, 1.4fr) 140px 110px 90px minmax(150px, 1fr)
          minmax(150px, 1fr) minmax(180px, 1fr);
        gap: 12px;
        padding: 14px;
        margin-bottom: 12px;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--text-color-muted);
        font-size: 12px;
      }

      input,
      select {
        width: 100%;
        min-width: 0;
        height: 34px;
        border: 1px solid var(--extra-border-color);
        border-radius: 6px;
        padding: 0 8px;
        background: var(--bg);
        color: var(--text-color);
      }

      .batch-bar {
        display: grid;
        grid-template-columns: auto 170px 170px minmax(180px, 1fr) auto auto;
        gap: 10px;
        align-items: center;
        padding: 10px 14px;
        margin-bottom: 12px;
      }

      .batch-bar span {
        color: var(--text-color-muted);
      }

      .entry-table {
        overflow: hidden;
      }

      .table-head,
      .table-row {
        display: grid;
        grid-template-columns:
          34px minmax(190px, 1.3fr) 190px 80px minmax(140px, 1fr)
          minmax(140px, 1fr) minmax(160px, 1fr) 132px;
        gap: 8px;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--extra-border-color);
      }

      .table-head {
        color: var(--text-color-muted);
        font-size: 12px;
        text-transform: uppercase;
        background: color-mix(in srgb, var(--card-bg) 88%, var(--text-color) 12%);
      }

      .table-row:last-child {
        border-bottom: 0;
      }

      .row-actions {
        display: flex;
        gap: 6px;
      }

      .empty,
      .server-required {
        padding: 18px;
        color: var(--text-color-muted);
      }

      @media (max-width: 980px) {
        .new-entry,
        .batch-bar,
        .table-head,
        .table-row {
          grid-template-columns: 1fr;
        }

        .table-head {
          display: none;
        }

        .table-row {
          gap: 10px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeEntryManagerPageComponent {
  readonly api = inject(PersonalApiService);
  private readonly _store = inject(Store);

  readonly entries = signal<PersonalTimeEntry[]>([]);
  readonly visions = signal<Vision[]>([]);
  readonly selected = signal<Record<string, boolean>>({});
  readonly selectedIds = computed(() =>
    Object.entries(this.selected())
      .filter(([, isSelected]) => isSelected)
      .map(([id]) => id),
  );

  readonly projects = toSignal(this._store.select(selectAllProjectsExceptInbox), {
    initialValue: [] as Project[],
  });

  newDescription = '';
  newDate = toLocalDate(new Date());
  newTime = toLocalTime(new Date());
  newDurationMinutes = 30;
  newProjectId = '';
  newVisionId = '';
  newTags = '';

  batchProjectId = '';
  batchVisionId = '';
  batchTags = '';

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.api.isAuthenticated()) return;
    const [entries, visions] = await Promise.all([
      this.api.listTimeEntries(),
      this.api.listVisions(),
    ]);
    this.entries.set(entries);
    this.visions.set(visions);
  }

  async createEntry(): Promise<void> {
    const start = localDateTimeToIso(this.newDate, this.newTime);
    const durationMs = Math.max(0, Number(this.newDurationMinutes || 0)) * 60 * 1000;
    const stop = new Date(new Date(start).getTime() + durationMs).toISOString();
    const entry = await this.api.createTimeEntry({
      description: this.newDescription,
      start,
      stop,
      durationMs,
      projectId: this.newProjectId || null,
      visionId: this.newVisionId || null,
      tags: splitTags(this.newTags),
    });
    this.entries.set([entry, ...this.entries()]);
    this.newDescription = '';
  }

  patchEntry(id: string, changes: Partial<PersonalTimeEntry>): void {
    this.entries.set(
      this.entries().map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    );
  }

  setEntryStart(id: string, value: string): void {
    const entry = this.entries().find((candidate) => candidate.id === id);
    if (!entry) return;
    const start = new Date(value).toISOString();
    const stop = new Date(new Date(start).getTime() + entry.durationMs).toISOString();
    this.patchEntry(id, { start, stop });
  }

  setEntryDuration(id: string, value: number | string): void {
    const entry = this.entries().find((candidate) => candidate.id === id);
    if (!entry) return;
    const durationMs = Math.max(0, Number(value || 0)) * 60 * 1000;
    const stop = new Date(new Date(entry.start).getTime() + durationMs).toISOString();
    this.patchEntry(id, { durationMs, stop });
  }

  setEntryTags(id: string, value: string): void {
    this.patchEntry(id, { tags: splitTags(value) });
  }

  async saveEntry(entry: PersonalTimeEntry): Promise<void> {
    const updated = await this.api.updateTimeEntry(entry.id, entry);
    this.patchEntry(entry.id, updated);
  }

  async deleteEntry(entry: PersonalTimeEntry): Promise<void> {
    await this.api.deleteTimeEntry(entry.id);
    this.entries.set(this.entries().filter((candidate) => candidate.id !== entry.id));
  }

  toggleSelected(id: string, isSelected: boolean): void {
    this.selected.set({ ...this.selected(), [id]: isSelected });
  }

  async applyBatch(): Promise<void> {
    const ids = this.selectedIds();
    if (!ids.length) return;
    const changes: Partial<PersonalTimeEntry> = {};
    if (this.batchProjectId) changes.projectId = this.batchProjectId;
    if (this.batchVisionId) changes.visionId = this.batchVisionId;
    if (this.batchTags.trim()) changes.tags = splitTags(this.batchTags);
    await this.api.batchUpdateTimeEntries(ids, changes);
    await this.refresh();
  }

  async deleteSelected(): Promise<void> {
    const ids = this.selectedIds();
    if (!ids.length) return;
    await this.api.batchDeleteTimeEntries(ids);
    this.selected.set({});
    await this.refresh();
  }

  durationMinutes(entry: PersonalTimeEntry): number {
    return Math.round(entry.durationMs / 60000);
  }

  toDateTimeLocal(value: string): string {
    const date = new Date(value);
    return `${toLocalDate(date)}T${toLocalTime(date)}`;
  }
}

const splitTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const pad = (value: number): string => String(value).padStart(2, '0');

const toLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toLocalTime = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const localDateTimeToIso = (date: string, time: string): string =>
  new Date(`${date}T${time || '00:00'}`).toISOString();
