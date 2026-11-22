import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { csvCell } from '../../domain/format';
import type { ImportBatch } from '../../domain/models';
import { ConfirmDialogService } from '../../kit/confirm-dialog.service';
import { downloadFile } from '../../kit/storage-utils';
import { KIT_THEMES, ThemeService } from '../../kit/theme.service';
import { ToastService } from '../../kit/toast.service';
import { LOCK_AFTER_MINUTES, LockService } from '../../services/lock.service';
import { MoneyModalsService } from '../../services/money-modals.service';
import { MoneyStateService } from '../../services/money-state.service';
import { MoneyStoreService } from '../../services/money-store.service';

@Component({
  selector: 'mm-data-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-bold tracking-tight mb-4">Data & Settings</h1>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Appearance -->
      <section class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-3">
          <h2 class="text-base font-bold">Appearance</h2>
          <p class="text-sm opacity-75">Choose a color theme. Defaults to following your system light or dark preference.</p>
          <label class="form-control w-full max-w-xs">
            <span class="label-text text-xs mb-1">Color theme</span>
            <select
              class="select select-bordered select-sm"
              aria-label="Color theme"
              (change)="themeService.setTheme($any($event.target).value)"
            >
              @for (t of themes; track t.id) {
                <option [value]="t.id" [selected]="themeService.theme() === t.id">{{ t.label }}</option>
              }
            </select>
          </label>
        </div>
      </section>

      <!-- Encrypted Backup -->
      <section class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-3">
          <h2 class="text-base font-bold">Backup & Restore</h2>
          <p class="text-sm opacity-75">
            Save an encrypted backup file (.backup) before switching browsers or clearing site data.
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary btn-sm" (click)="saveBackup()">
              Save backup
            </button>
            <button type="button" class="btn btn-outline btn-sm" (click)="restoreInput.click()">
              Restore backup
            </button>
            <input
              #restoreInput
              type="file"
              accept=".backup,.json"
              class="hidden"
              (change)="onRestorePicked($event)"
            />
          </div>
        </div>
      </section>

      <!-- Device Passkey Lock -->
      <section id="lock-card" class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-3">
          <h2 class="text-base font-bold">Lock on this device</h2>
          <p class="text-sm opacity-75">
            Require your device passkey (Face ID, Touch ID, Windows Hello, or PIN) when opening the app or after {{ lockMinutes }} minutes away.
          </p>
          @if (lock.isOn()) {
            <div class="flex items-center gap-3">
              <span class="badge badge-success">Lock is on</span>
              <button id="lock-off" type="button" class="btn btn-outline btn-sm" (click)="disableLock()">
                Turn off lock
              </button>
            </div>
          } @else {
            <div class="flex flex-col items-start gap-2">
              <button
                id="lock-on"
                type="button"
                class="btn btn-primary btn-sm"
                [disabled]="!lock.supported() || lock.busy()"
                (click)="enableLock()"
              >
                Turn on lock
              </button>
              @if (!lock.supported()) {
                <span class="text-xs opacity-65">Platform passkey authenticator is not available here.</span>
              }
            </div>
          }
        </div>
      </section>

      <!-- CSV Export & Erase -->
      <section class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-3">
          <h2 class="text-base font-bold">Spreadsheet & Reset</h2>
          <p class="text-sm opacity-75">
            {{ state.tx().length }} saved transaction{{ state.tx().length === 1 ? '' : 's' }} in local browser storage.
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline btn-sm" [disabled]="!state.tx().length" (click)="exportCsv()">
              Export CSV
            </button>
            <button type="button" class="btn btn-error btn-outline btn-sm" (click)="eraseAll()">
              Erase all data on this device
            </button>
          </div>
        </div>
      </section>

      <!-- Import History -->
      <section class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-2">
          <h2 class="text-base font-bold">Import history</h2>
          @if (!state.batches().length) {
            <p class="text-sm opacity-70">No saved imports yet.</p>
          } @else {
            <div class="flex flex-col gap-2">
              @for (b of state.batches(); track b.id) {
                <div class="flex items-center justify-between gap-2 py-1 border-b border-base-200 text-sm">
                  <div class="min-w-0">
                    <div class="font-medium truncate">{{ b.files.join(', ') || 'Import' }}</div>
                    <div class="text-xs opacity-70">{{ b.at.slice(0, 10) }} · {{ b.count }} rows</div>
                  </div>
                  <button type="button" class="btn btn-ghost btn-xs text-error" (click)="undoBatch(b)">
                    Undo
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <!-- Categories -->
      <section class="card bg-base-100 border border-base-300">
        <div class="card-body p-4 gap-2">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-base font-bold">Categories</h2>
            <button type="button" class="btn btn-ghost btn-xs" (click)="addCategory()">+ Add category</button>
          </div>
          @if (!unusedCategories().length) {
            <p class="text-sm opacity-70">Every category is currently in use.</p>
          } @else {
            <p class="text-xs opacity-70">Unused categories can be removed:</p>
            <div class="flex flex-wrap gap-2">
              @for (cat of unusedCategories(); track cat) {
                <div class="badge badge-outline gap-1 py-3 px-2.5">
                  <span>{{ cat }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs px-1 text-error"
                    [attr.aria-label]="'Remove ' + cat"
                    (click)="state.removeCategory(cat)"
                  >
                    Remove
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class DataPageComponent {
  readonly state = inject(MoneyStateService);
  readonly store = inject(MoneyStoreService);
  readonly lock = inject(LockService);
  readonly themeService = inject(ThemeService);
  private readonly modals = inject(MoneyModalsService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  readonly themes = KIT_THEMES;
  readonly lockMinutes = LOCK_AFTER_MINUTES;

  readonly unusedCategories = computed(() => {
    const used = new Set(this.state.tx().map(r => r.cat).filter(Boolean));
    return Object.keys(this.state.categories()).filter(c => c !== 'Savings' && !used.has(c));
  });

  async saveBackup(): Promise<void> {
    const pass = await this.modals.askText('Encrypt backup', {
      label: 'Passphrase to lock this backup file',
      type: 'password',
      action: 'Continue',
      note: 'You will need this passphrase to restore the backup.',
    });
    if (!pass) return;
    const confirmPass = await this.modals.askText('Confirm passphrase', {
      label: 'Type the passphrase again',
      type: 'password',
      action: 'Save backup',
    });
    if (!confirmPass) return;
    if (confirmPass !== pass) {
      this.toast.show('Passphrases did not match.');
      return;
    }
    const data = await this.store.exportAll();
    const payload = await this.store.encryptBackup(data, pass);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`money-manager-${stamp}.backup`, payload, 'application/octet-stream');
    this.toast.show('Encrypted backup downloaded.');
  }

  async onRestorePicked(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    const entered = await this.modals.askText('Unlock backup', {
      label: 'Passphrase',
      type: 'password',
      action: 'Continue',
    });
    if (!entered) return;
    const pass = entered;
    try {
      const data = await this.store.decryptBackup(text, pass);
      const ok = await this.confirm.confirm(
        'Restore backup?',
        `Replace all local data with ${(data.tx || []).length} transactions from this backup?`,
        'Replace',
      );
      if (!ok) return;
      await this.state.restoreFromBackup(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast.show(msg || 'Could not read backup.');
    }
  }

  async enableLock(): Promise<void> {
    try {
      const credId = await this.lock.createPasskey();
      const code = this.lock.generateRecoveryCode();
      const confirmed = await this.modals.showRecoveryCode(code);
      if (!confirmed) return;
      await this.lock.turnOn(credId, code);
      this.toast.show('Device lock turned on.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Passkey setup cancelled.';
      this.toast.show(msg);
    }
  }

  async disableLock(): Promise<void> {
    try {
      await this.lock.turnOff();
      this.toast.show('Lock turned off.');
    } catch {
      this.toast.show('Verification failed — lock is still on.');
    }
  }

  async undoBatch(b: ImportBatch): Promise<void> {
    const ok = await this.confirm.confirm(
      'Undo import?',
      `Remove ${b.count} transaction${b.count === 1 ? '' : 's'} from ${b.files.join(', ') || 'this import'}?`,
      'Undo import',
    );
    if (!ok) return;
    await this.state.undoBatch(b);
  }

  async addCategory(): Promise<void> {
    const name = await this.modals.askText('New category', { label: 'Category name', action: 'Add' });
    if (name) await this.state.addCategory(name);
  }

  exportCsv(): void {
    const headers = ['Date', 'Account', 'Description', 'Type', 'Category', 'Subcategory', 'Amount'];
    const lines = [
      headers.join(','),
      ...this.state.tx().map(r =>
        [
          csvCell(r.date),
          csvCell(r.account),
          csvCell(r.desc),
          csvCell(r.kind),
          csvCell(r.cat),
          csvCell(r.sub),
          csvCell((r.cents / 100).toFixed(2)),
        ].join(','),
      ),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`money-manager-${stamp}.csv`, lines.join('\n'), 'text/csv');
    this.toast.show('CSV exported.');
  }

  async eraseAll(): Promise<void> {
    const ok = await this.confirm.confirm(
      'Erase all data?',
      'This deletes all imported transactions, budgets, rules, and categories from this browser.',
      'Erase',
    );
    if (!ok) return;
    await this.state.eraseAllData();
  }
}
