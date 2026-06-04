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
import { updateProject } from '../../features/project/store/project.actions';
import { selectAllProjectsExceptInbox } from '../../features/project/store/project.selectors';
import { PersonalApiService } from '../../personal-server/personal-api.service';
import { Vision } from '../../personal-server/personal-api.model';

@Component({
  selector: 'vision-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="vision-page">
      <header>
        <div>
          <h1>愿景</h1>
        </div>
        <button
          type="button"
          class="primary"
          (click)="createVision()"
        >
          + 新建愿景
        </button>
      </header>

      @if (api.isAuthenticated()) {
        <section class="workspace">
          <div class="vision-list">
            @for (vision of visions(); track vision.id) {
              <button
                type="button"
                class="vision-row"
                [class.active]="vision.id === selectedVisionId()"
                (click)="selectedVisionId.set(vision.id)"
              >
                <span
                  class="swatch"
                  [style.background]="vision.color"
                ></span>
                <span>{{ vision.title }}</span>
                <small>{{ projectsForVision(vision.id).length }} 项目</small>
              </button>
            } @empty {
              <div class="empty">还没有愿景。</div>
            }
          </div>

          <section class="editor">
            @if (selectedVision(); as vision) {
              <div class="editor-grid">
                <label>
                  名称
                  <input
                    [ngModel]="vision.title"
                    (ngModelChange)="updateVision(vision, { title: $event })"
                  />
                </label>
                <label>
                  颜色
                  <input
                    type="color"
                    [ngModel]="vision.color"
                    (ngModelChange)="updateVision(vision, { color: $event })"
                  />
                </label>
                <label class="full">
                  描述
                  <textarea
                    rows="4"
                    [ngModel]="vision.description"
                    (ngModelChange)="updateVision(vision, { description: $event })"
                  ></textarea>
                </label>
              </div>

              <div class="project-table">
                <div class="table-head">
                  <span>项目</span>
                  <span>归属愿景</span>
                </div>
                @for (project of projects(); track project.id) {
                  <div class="table-row">
                    <span>{{ project.title }}</span>
                    <select
                      [ngModel]="project.visionId || ''"
                      (ngModelChange)="assignProjectVision(project, $event || null)"
                    >
                      <option value="">未分配</option>
                      @for (v of visions(); track v.id) {
                        <option [value]="v.id">{{ v.title }}</option>
                      }
                    </select>
                  </div>
                }
              </div>

              <div class="actions">
                <button
                  type="button"
                  class="danger"
                  (click)="deleteVision(vision)"
                >
                  删除愿景
                </button>
              </div>
            } @else {
              <div class="empty">选择或新建一个愿景。</div>
            }
          </section>
        </section>
      } @else {
        <section class="server-required">
          个人服务器未登录。愿景数据需要服务器本地 SQLite。
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

      .vision-page {
        padding: 20px 24px 32px;
        max-width: 1180px;
        margin: 0 auto;
      }

      header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 4px;
        font-size: 24px;
      }

      button,
      input,
      textarea,
      select {
        font: inherit;
      }

      button {
        border: 1px solid var(--extra-border-color);
        border-radius: 6px;
        background: var(--card-bg);
        color: var(--text-color);
        cursor: pointer;
      }

      .primary {
        height: 36px;
        padding: 0 14px;
        background: var(--c-accent);
        border-color: var(--c-accent);
        color: white;
      }

      .workspace {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        gap: 20px;
      }

      .vision-list,
      .editor,
      .server-required {
        border: 1px solid var(--extra-border-color);
        border-radius: 8px;
        background: var(--card-bg);
      }

      .vision-list {
        display: grid;
        align-content: start;
        padding: 8px;
      }

      .vision-row {
        min-height: 42px;
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 8px;
        text-align: left;
        border-color: transparent;
        background: transparent;
      }

      .vision-row.active {
        background: var(--selected-task-bg-color);
        border-color: var(--extra-border-color);
      }

      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      small {
        color: var(--text-color-muted);
      }

      .editor {
        padding: 18px;
      }

      .editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 90px;
        gap: 14px;
        margin-bottom: 20px;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--text-color-muted);
        font-size: 13px;
      }

      .full {
        grid-column: 1 / -1;
      }

      input,
      textarea,
      select {
        width: 100%;
        border: 1px solid var(--extra-border-color);
        border-radius: 6px;
        padding: 8px 10px;
        background: var(--bg);
        color: var(--text-color);
      }

      .project-table {
        border-top: 1px solid var(--extra-border-color);
      }

      .table-head,
      .table-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 240px;
        gap: 16px;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid var(--extra-border-color);
      }

      .table-head {
        color: var(--text-color-muted);
        font-size: 12px;
        text-transform: uppercase;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }

      .danger {
        height: 34px;
        padding: 0 12px;
        color: #b00020;
      }

      .empty,
      .server-required {
        padding: 18px;
        color: var(--text-color-muted);
      }

      @media (max-width: 760px) {
        .workspace {
          grid-template-columns: 1fr;
        }

        .table-head,
        .table-row {
          grid-template-columns: 1fr;
          gap: 8px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisionPageComponent {
  readonly api = inject(PersonalApiService);
  private readonly _store = inject(Store);
  readonly visions = signal<Vision[]>([]);
  readonly selectedVisionId = signal<string | null>(null);
  readonly projects = toSignal(this._store.select(selectAllProjectsExceptInbox), {
    initialValue: [] as Project[],
  });
  readonly selectedVision = computed(
    () => this.visions().find((v) => v.id === this.selectedVisionId()) || null,
  );

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.api.isAuthenticated()) return;
    const visions = await this.api.listVisions();
    this.visions.set(visions);
    if (!this.selectedVisionId() && visions[0]) {
      this.selectedVisionId.set(visions[0].id);
    }
  }

  projectsForVision(visionId: string): Project[] {
    return this.projects().filter((project) => project.visionId === visionId);
  }

  async createVision(): Promise<void> {
    const vision = await this.api.createVision({
      title: `愿景 ${this.visions().length + 1}`,
      description: '',
      color: '#2f7dd3',
    });
    this.visions.set([vision, ...this.visions()]);
    this.selectedVisionId.set(vision.id);
  }

  async updateVision(vision: Vision, changes: Partial<Vision>): Promise<void> {
    const updatedLocal = { ...vision, ...changes, updatedAt: new Date().toISOString() };
    this.visions.set(this.visions().map((v) => (v.id === vision.id ? updatedLocal : v)));
    const updated = await this.api.updateVision(vision.id, changes);
    this.visions.set(this.visions().map((v) => (v.id === vision.id ? updated : v)));
  }

  async deleteVision(vision: Vision): Promise<void> {
    await this.api.deleteVision(vision.id);
    this.visions.set(this.visions().filter((v) => v.id !== vision.id));
    if (this.selectedVisionId() === vision.id) {
      this.selectedVisionId.set(this.visions()[0]?.id || null);
    }
  }

  assignProjectVision(project: Project, visionId: string | null): void {
    this._store.dispatch(
      updateProject({
        project: {
          id: project.id,
          changes: {
            visionId,
          },
        },
      }),
    );
  }
}
