// Floating countdown timer bar component bound to TimerService.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TimerService } from './timer.service';

@Component({
  selector: 'kit-timer-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      id="timer-bar"
      class="timer-bar"
      role="timer"
      aria-label="Speaking timer"
      [hidden]="!timer.running()"
    >
      <span id="timer-label">{{ timer.label() }}</span>
      <b id="timer-time">{{ timer.formattedTime() }}</b>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        aria-label="30 seconds less"
        (click)="timer.adjust(-30)"
      >
        −30
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        aria-label="30 seconds more"
        (click)="timer.adjust(30)"
      >
        +30
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        (click)="timer.stop()"
      >
        Stop
      </button>
      <div class="timer-track" aria-hidden="true">
        <i id="timer-fill" [style.width.%]="timer.progressPct()"></i>
      </div>
    </div>
  `,
})
export class TimerBarComponent {
  readonly timer = inject(TimerService);
}
