import type { Routes } from '@angular/router';
import { DashboardPageComponent } from './views/dashboard/dashboard-page.component';

export const routes: Routes = [
  { path: '', component: DashboardPageComponent, pathMatch: 'full' },
  {
    path: 'tx',
    loadComponent: () =>
      import('./views/transactions/transactions-page.component').then(m => m.TransactionsPageComponent),
  },
  {
    path: 'import',
    loadComponent: () => import('./views/import/import-page.component').then(m => m.ImportPageComponent),
  },
  {
    path: 'data',
    loadComponent: () => import('./views/data/data-page.component').then(m => m.DataPageComponent),
  },
  { path: '**', redirectTo: '' },
];
