import {
  type ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { ThemeService } from './kit/theme.service';
import { LockService } from './services/lock.service';
import { MoneyStateService } from './services/money-state.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withHashLocation(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
    provideAppInitializer(async () => {
      inject(ThemeService);
      const lock = inject(LockService);
      const state = inject(MoneyStateService);
      await lock.init();
      if (lock.isOn()) {
        void lock.untilUnlocked();
      } else {
        await state.loadAll();
      }
    }),
  ],
};
