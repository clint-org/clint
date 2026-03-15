import {
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-modal',
  standalone: true,
  templateUrl: './modal.component.html',
})
export class ModalComponent {
  isOpen = input.required<boolean>();
  title = input.required<string>();

  closed = output<void>();

  private readonly dialogEl = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly titleId = signal(`modal-title-${crypto.randomUUID().slice(0, 8)}`);

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const dialog = this.dialogEl()?.nativeElement;
      if (!dialog) return;

      if (open && !dialog.open) {
        dialog.showModal();
      } else if (!open && dialog.open) {
        dialog.close();
      }
    });
  }

  getTitleId(): string {
    return this.titleId();
  }

  onDialogClose(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialogEl()?.nativeElement;
    if (event.target === dialog) {
      this.closed.emit();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    }
  }
}
