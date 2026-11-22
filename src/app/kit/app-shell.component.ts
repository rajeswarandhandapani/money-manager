// Reusable PWA app shell with sticky header, router navigation tabs, timer bar, toast, and confirm modal.

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { TimerBarComponent } from './timer-bar.component';
import { ToastComponent } from './toast.component';

export interface KitNavItem {
  label: string;
  path: string;
  exact?: boolean;
}

@Component({
  selector: 'kit-app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, TimerBarComponent, ToastComponent, ConfirmDialogComponent],
  template: `
    <header class="app-header">
      <div class="app-header-inner">
        <span class="font-bold tracking-tight whitespace-nowrap">{{ brand() }}</span>
        <nav aria-label="Main" class="app-nav flex gap-1 overflow-x-auto">
          @for (item of navItems(); track item.path) {
            <button
              type="button"
              [routerLink]="item.path"
              routerLinkActive
              #rla="routerLinkActive"
              [routerLinkActiveOptions]="{ exact: !!item.exact }"
              [attr.aria-current]="rla.isActive ? 'page' : null"
              class="btn btn-ghost btn-sm min-h-10 whitespace-nowrap font-normal"
              [class.btn-active]="rla.isActive"
              [class.font-semibold]="rla.isActive"
            >
              {{ item.label }}
            </button>
          }
        </nav>
      </div>
    </header>
    <main id="main" class="app-main">
      <ng-content />
    </main>
    <kit-timer-bar />
    <kit-toast />
    <kit-confirm-dialog />
  `,
})
export class AppShellComponent {
  readonly brand = input.required<string>();
  readonly navItems = input.required<KitNavItem[]>();
}
