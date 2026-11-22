import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { LockService } from '../services/lock.service';

@Component({
  selector: 'mm-lock-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="lock" class="bg-base-200 text-base-content">
      <div class="card bg-base-100 border border-base-300 shadow-sm w-full max-w-sm">
        <div class="card-body items-center text-center gap-3">
          <h1 class="text-2xl font-bold">Money Manager</h1>
          <p class="text-sm opacity-75">Locked on this device</p>

          <button
            id="unlock"
            type="button"
            class="btn btn-primary w-full"
            [disabled]="lock.busy()"
            (click)="unlock()"
          >
            {{ lock.busy() ? 'Checking…' : 'Unlock' }}
          </button>

          @if (!showRecovery()) {
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="showRecovery.set(true)"
            >
              Use recovery code
            </button>
          } @else {
            <div class="flex flex-col gap-2 w-full mt-1">
              <input
                type="text"
                class="input input-bordered font-mono tracking-wider uppercase text-center w-full"
                placeholder="Recovery code"
                aria-label="Recovery code"
                [value]="code()"
                (input)="code.set($any($event.target).value)"
                (keydown.enter)="unlockWithCode()"
              />
              <button
                type="button"
                class="btn btn-primary w-full"
                [disabled]="lock.busy()"
                (click)="unlockWithCode()"
              >
                Unlock with code
              </button>
            </div>
          }

          <p class="lock-message text-error text-sm min-h-5" aria-live="polite">
            {{ lock.message() }}
          </p>
        </div>
      </div>
    </div>
  `,
})
export class LockScreenComponent {
  readonly lock = inject(LockService);
  readonly unlocked = output<void>();

  readonly showRecovery = signal(false);
  readonly code = signal('');

  async unlock(): Promise<void> {
    await this.lock.unlockWithPasskey();
    if (!this.lock.locked()) {
      this.unlocked.emit();
    }
  }

  async unlockWithCode(): Promise<void> {
    await this.lock.unlockWithRecoveryCode(this.code());
    if (!this.lock.locked()) {
      this.code.set('');
      this.showRecovery.set(false);
      this.unlocked.emit();
    }
  }
}
