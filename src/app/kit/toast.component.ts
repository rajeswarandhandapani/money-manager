// Toast notification overlay component bound to ToastService.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'kit-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="toast" role="status" aria-live="polite" [class.show]="toast.visible()">
      @if (toast.visible()) {
        <span class="text-sm">{{ toast.message() }}</span>
        @if (toast.action(); as act) {
          <button type="button" class="btn btn-xs btn-ghost underline" (click)="toast.runAction()">
            {{ act.label }}
          </button>
        }
      }
    </div>
  `,
})
export class ToastComponent {
  readonly toast = inject(ToastService);
}
