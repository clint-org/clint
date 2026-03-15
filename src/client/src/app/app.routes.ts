import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/auth-callback.component').then(
        (m) => m.AuthCallbackComponent
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'manage/companies',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/manage/companies/company-list.component'
      ).then((m) => m.CompanyListComponent),
  },
  {
    path: 'manage/products',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/manage/products/product-list.component'
      ).then((m) => m.ProductListComponent),
  },
  {
    path: 'manage/trials/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/manage/trials/trial-detail.component'
      ).then((m) => m.TrialDetailComponent),
  },
  {
    path: 'manage/marker-types',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/manage/marker-types/marker-type-list.component'
      ).then((m) => m.MarkerTypeListComponent),
  },
  {
    path: 'manage/therapeutic-areas',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/manage/therapeutic-areas/therapeutic-area-list.component'
      ).then((m) => m.TherapeuticAreaListComponent),
  },
];
