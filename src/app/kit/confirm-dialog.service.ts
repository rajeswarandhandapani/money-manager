// Promise-based confirmation modal service.

import { Injectable, signal } from '@angular/core';

export interface ConfirmState {
  title: string;
  body: string;
  yesLabel: string;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly state = signal<ConfirmState | null>(null);
  private pendingResolve: ((answer: boolean) => void) | null = null;

  confirm(title: string, body: string, yesLabel = 'Confirm'): Promise<boolean> {
    if (this.pendingResolve) {
      this.pendingResolve(false);
      this.pendingResolve = null;
    }
    this.state.set({ title, body, yesLabel });
    return new Promise<boolean>(resolve => {
      this.pendingResolve = resolve;
    });
  }

  close(answer: boolean): void {
    const res = this.pendingResolve;
    this.pendingResolve = null;
    this.state.set(null);
    res?.(answer);
  }
}
