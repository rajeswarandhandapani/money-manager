// Native <dialog> confirmation modal powered by DaisyUI modal styles and ConfirmDialogService.

import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  selector: 'kit-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" (cancel)="onCancel($event)">
      @if (svc.state(); as s) {
        <div class="modal-box max-w-md border border-base-300 bg-base-100 text-base-content">
          <h2 class="text-lg font-bold">{{ s.title }}</h2>
          <p class="py-3 text-sm opacity-80">{{ s.body }}</p>
          <div class="modal-action mt-2">
            <button type="button" class="btn btn-ghost" (click)="svc.close(false)">Cancel</button>
            <button type="button" class="btn btn-error" (click)="svc.close(true)">{{ s.yesLabel }}</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmDialogComponent {
  readonly svc = inject(ConfirmDialogService);
  private readonly dlgRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const s = this.svc.state();
      const el = this.dlgRef()?.nativeElement;
      if (!el) return;
      if (s && !el.open) el.showModal();
      else if (!s && el.open) el.close();
    });
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.svc.close(false);
  }
}
