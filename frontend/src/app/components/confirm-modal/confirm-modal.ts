
import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  templateUrl: './confirm-modal.html',
  styleUrl: './confirm-modal.scss',
})
export class ConfirmModal {
  title = input.required<string>();
  description = input.required<string>();

  confirmText = input('Подтвердить');
  cancelText = input('Отмена');

  variant = input<'danger' | 'default'>('danger');
  icon = input<'delete' | 'leave' | 'member' | 'none'>('delete');

  loading = input(false);
  loadingText = input('Выполнение…');
  error = input('');

  confirm = output<void>();
  cancel = output<void>();
}
