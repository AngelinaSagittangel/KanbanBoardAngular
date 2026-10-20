
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class CardDeletionService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(cardId: string, callback: () => void, delay = 5000): void {
    this.cancel(cardId);

    const timer = setTimeout(() => {
      this.timers.delete(cardId);
      callback();
    }, delay);

    this.timers.set(cardId, timer);
  }

  cancel(cardId: string): void {
    const timer = this.timers.get(cardId);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(cardId);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  has(cardId: string): boolean {
    return this.timers.has(cardId);
  }
}
