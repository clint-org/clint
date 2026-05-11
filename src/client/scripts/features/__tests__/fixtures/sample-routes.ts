import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'login', loadComponent: () => null as never },
  {
    path: 't/:tenantId',
    children: [
      {
        path: 's/:spaceId',
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => null as never },
          { path: 'timeline', loadComponent: () => null as never },
          { path: 'manage/trials', loadComponent: () => null as never },
          { path: 'old-route', redirectTo: 'timeline' },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
