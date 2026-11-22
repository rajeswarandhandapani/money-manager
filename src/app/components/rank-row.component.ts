import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'mm-rank-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (interactive()) {
      <button type="button" class="bar-row" (click)="picked.emit()">
        <span class="bar-label font-medium text-sm">{{ label() }}</span>
        <span class="bar-val font-semibold text-sm tabular-nums">{{ valText() }}</span>
        <span class="bar-track" aria-hidden="true">
          <span class="bar-fill" [style.width.%]="fillPct()"></span>
          @if (overPct() > 0) {
            <span class="bar-over" [style.left.%]="fillPct()" [style.width.%]="overPct()"></span>
          }
          @if (targetPct() !== null) {
            <span class="bar-target" [style.left.%]="targetPct()"></span>
          }
        </span>
        @if (note()) {
          <span class="bar-note" [class.over]="over()">{{ note() }}</span>
        }
      </button>
    } @else {
      <div class="bar-row static">
        <span class="bar-label font-medium text-sm">{{ label() }}</span>
        <span class="bar-val font-semibold text-sm tabular-nums">{{ valText() }}</span>
        <span class="bar-track" aria-hidden="true">
          <span class="bar-fill" [style.width.%]="fillPct()"></span>
          @if (overPct() > 0) {
            <span class="bar-over" [style.left.%]="fillPct()" [style.width.%]="overPct()"></span>
          }
          @if (targetPct() !== null) {
            <span class="bar-target" [style.left.%]="targetPct()"></span>
          }
        </span>
        @if (note()) {
          <span class="bar-note" [class.over]="over()">{{ note() }}</span>
        }
      </div>
    }
  `,
})
export class RankRowComponent {
  readonly label = input.required<string>();
  readonly valText = input.required<string>();
  readonly fillPct = input.required<number>();
  readonly overPct = input(0);
  readonly targetPct = input<number | null>(null);
  readonly note = input('');
  readonly over = input(false);
  readonly interactive = input(false);
  readonly picked = output<void>();
}
