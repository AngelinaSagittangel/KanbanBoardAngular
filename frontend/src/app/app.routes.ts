import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { BoardPage } from './pages/board-page/board-page';

export const routes: Routes = [
  {
    path: '',
    component: BoardPage,
    canActivate: [authGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((module) => module.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then((module) => module.RegisterPage),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
