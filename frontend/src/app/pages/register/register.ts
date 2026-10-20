import { Component, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';

type RegisterField = 'name' | 'email' | 'password';

interface RegisterValidationError {
  field: string;
  message: string;
}

interface RegisterErrorResponse {
  message?: string;
  errors?: RegisterValidationError[];
}

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterPage {
  name = '';
  email = '';
  password = '';

  errorMessage = signal('');
  fieldErrors = signal<Partial<Record<RegisterField, string>>>({});
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
    this.fieldErrors.set({});

    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    this.authService
      .register({
        name: this.name.trim(),
        email: this.email.trim(),
        password: this.password,
      })
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: () => {
          this.router.navigateByUrl('/');
        },
        error: (error: HttpErrorResponse) => {
          this.handleRegistrationError(error);
        },
      });
  }

  clearFieldError(field: RegisterField): void {
    this.fieldErrors.update((errors) => {
      if (!errors[field]) {
        return errors;
      }

      const updatedErrors = { ...errors };
      delete updatedErrors[field];

      return updatedErrors;
    });

    this.errorMessage.set('');
  }

  private handleRegistrationError(error: HttpErrorResponse): void {
    const response = error.error as RegisterErrorResponse | null;

    if (error.status === 409) {
      this.fieldErrors.update((errors) => ({
        ...errors,
        email: 'Пользователь с таким email уже существует',
      }));

      return;
    }

    if (response?.errors?.length) {
      const updatedErrors: Partial<Record<RegisterField, string>> = {};

      for (const item of response.errors) {
        if (item.field === 'name' || item.field === 'email' || item.field === 'password') {
          updatedErrors[item.field] ??= item.message;
        }
      }

      if (Object.keys(updatedErrors).length > 0) {
        this.fieldErrors.update((errors) => ({
          ...errors,
          ...updatedErrors,
        }));
      } else {
        this.errorMessage.set(response.message ?? 'Проверьте введённые данные.');
      }

      return;
    }

    this.errorMessage.set(response?.message ?? 'Не удалось создать аккаунт. Попробуйте ещё раз.');
  }
}
