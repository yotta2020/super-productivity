import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PersonalApiService } from './personal-api.service';

@Component({
  selector: 'personal-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="login-shell">
      <section class="login-panel">
        <div class="login-mark">SP</div>
        <h1>个人工作台登录</h1>

        <form (ngSubmit)="login()">
          <label>
            账户
            <input
              name="username"
              autocomplete="username"
              [(ngModel)]="username"
            />
          </label>

          <label>
            密码
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              [(ngModel)]="password"
            />
          </label>

          @if (error()) {
            <div class="error">{{ error() }}</div>
          }

          <button
            type="submit"
            [disabled]="isLoading()"
          >
            {{ isLoading() ? '登录中...' : '登录' }}
          </button>
        </form>

        <footer>{{ api.baseUrl }}</footer>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background:
          linear-gradient(rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.92)),
          url('/assets/icons/icon-512x512.png') center 16% / 180px no-repeat;
      }

      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .login-panel {
        width: min(420px, 100%);
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        padding: 28px;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.14);
      }

      .login-mark {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        background: #2f7dd3;
        color: white;
        font-weight: 700;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
      }

      form {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 6px;
        font-size: 13px;
        color: rgba(0, 0, 0, 0.72);
      }

      input {
        height: 42px;
        border: 1px solid rgba(0, 0, 0, 0.22);
        border-radius: 6px;
        padding: 0 12px;
        font: inherit;
      }

      input:focus {
        outline: 2px solid rgba(47, 125, 211, 0.22);
        border-color: #2f7dd3;
      }

      button {
        height: 42px;
        border: 0;
        border-radius: 6px;
        background: #2f7dd3;
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.65;
        cursor: default;
      }

      .error {
        color: #b00020;
        font-size: 13px;
      }

      footer {
        margin-top: 18px;
        color: rgba(0, 0, 0, 0.5);
        font-size: 12px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalLoginComponent {
  readonly api = inject(PersonalApiService);
  username = 'admin';
  password = '';
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  async login(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.api.login(this.username.trim(), this.password);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isLoading.set(false);
    }
  }
}
