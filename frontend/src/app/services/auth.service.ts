import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthResponse {
  message: string;
  user: AuthUser;
  token: string;
}

interface MeResponse {
  user: AuthUser;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly apiUrl = 'http://localhost:3000/api/auth';
  private readonly tokenKey = 'kanban_token';

  user = signal<AuthUser | null>(null);

  constructor(private http: HttpClient) {}

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  register(data: { name: string; email: string; password: string }): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/register`, data)
      .pipe(tap((response) => this.saveSession(response)));
  }

  login(data: { email: string; password: string }): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/login`, data)
      .pipe(tap((response) => this.saveSession(response)));
  }

  checkSession(): Observable<boolean> {
    if (!this.getToken()) {
      this.user.set(null);
      return of(false);
    }

    if (this.user()) {
      return of(true);
    }

    return this.http.get<MeResponse>(`${this.apiUrl}/me`).pipe(
      tap((response) => this.user.set(response.user)),
      map(() => true),
      catchError(() => {
        this.logout();
        return of(false);
      }),
    );
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.user.set(null);
  }

  private saveSession(response: AuthResponse): void {
    localStorage.setItem(this.tokenKey, response.token);
    this.user.set(response.user);
  }
}
