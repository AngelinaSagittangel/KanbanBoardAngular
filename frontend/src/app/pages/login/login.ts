import { Component, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  email = '';
  password = '';

  errorMessage = signal('');
  isLoading = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  submit(form: NgForm): void {
    if (this.isLoading()) {
      return;
    }

    this.errorMessage.set('');

    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    this.authService
      .login({
        email: this.email.trim(),
        password: this.password,
      })
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: () => {
          this.router.navigateByUrl('/');
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Не удалось выполнить вход. Попробуйте ещё раз.',
          );
        },
      });
  }

  clearError(): void {
    this.errorMessage.set('');
  }
}
