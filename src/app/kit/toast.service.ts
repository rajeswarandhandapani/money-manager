// Signal-based toast notification service.

import { Injectable, signal } from '@angular/core';

export interface ToastAction {
  label: string;
  run: () => void;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly visible = signal(false);
  readonly message = signal('');
  readonly action = signal<ToastAction | null>(null);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  show(msg: string, action: ToastAction | null = null): void {
    this.message.set(msg);
    this.action.set(action);
    this.visible.set(true);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.dismiss(), action ? 6000 : 3200);
  }

  runAction(): void {
    const act = this.action();
    this.dismiss();
    act?.run();
  }

  dismiss(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.visible.set(false);
  }
}
