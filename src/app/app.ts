import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DialogsComponent } from './components/dialogs.component';
import { LockScreenComponent } from './components/lock-screen.component';
import { AppShellComponent, type KitNavItem } from './kit/app-shell.component';
import { LockService } from './services/lock.service';
import { MoneyStateService } from './services/money-state.service';

const NAV_ITEMS: KitNavItem[] = [
  { label: 'Dashboard', path: '/', exact: true },
  { label: 'Transactions', path: '/tx' },
  { label: 'Import', path: '/import' },
  { label: 'Data', path: '/data' },
];

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppShellComponent, RouterOutlet, LockScreenComponent, DialogsComponent],
  template: `
    @if (lock.locked()) {
      <mm-lock-screen (unlocked)="onUnlocked()" />
    }
    <kit-app-shell brand="Money Manager" [navItems]="navItems">
      @if (!lock.locked()) {
        <router-outlet />
      }
    </kit-app-shell>
    @if (!lock.locked()) {
      <div class="drop-veil" aria-hidden="true">Drop bank CSV or .xlsx files to import</div>
      <mm-dialogs />
    }
  `,
})
export class App {
  readonly lock = inject(LockService);
  private readonly state = inject(MoneyStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly navItems = NAV_ITEMS;
  private dragDepth = 0;

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationStart => e instanceof NavigationStart),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(ev => {
        this.state.revertDrafts();
        if (this.router.url.startsWith('/tx') && !ev.url.startsWith('/tx')) {
          this.state.filter.set({});
        }
      });

    afterNextRender(() => {
      if (!this.lock.locked() && this.state.loaded() && !this.state.tx().length && this.router.url === '/') {
        void this.router.navigateByUrl('/import');
      }
      this.bindGlobalDrop();
    });
  }

  async onUnlocked(): Promise<void> {
    if (!this.state.loaded()) {
      await this.state.loadAll();
    }
    if (!this.state.tx().length) {
      void this.router.navigateByUrl('/import');
    }
  }

  private bindGlobalDrop(): void {
    if (typeof window === 'undefined') return;
    const setDragging = (on: boolean) => document.body.classList.toggle('dragging', on);

    const onDragEnter = (e: DragEvent) => {
      if (this.lock.locked()) return;
      if (!e.dataTransfer?.types?.includes('Files')) return;
      this.dragDepth++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (this.lock.locked()) return;
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    const onDragLeave = () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      this.dragDepth = 0;
      setDragging(false);
      if (this.lock.locked()) return;
      const files = e.dataTransfer?.files;
      if (files?.length) {
        e.preventDefault();
        void this.state.addFiles(files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      setDragging(false);
    });
  }
}
