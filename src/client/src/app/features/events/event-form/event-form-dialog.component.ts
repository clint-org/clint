import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { EventFormComponent } from './event-form.component';
import type { AnchorType } from './event-payload';

/**
 * Reusable dialog host for the merged Event form. Every contextual entry point
 * (profile pages, timeline, manage/trials) opens this with a preset anchor so they
 * all launch the same EventFormComponent.
 */
@Component({
  selector: 'app-event-form-dialog',
  imports: [Dialog, EventFormComponent],
  template: `
    <p-dialog
      [header]="mode() === 'edit' ? 'Edit event' : 'Log event'"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      styleClass="!w-[46rem] !max-w-[95vw]"
      appendTo="body"
    >
      @if (visible()) {
        <app-event-form
          [spaceId]="spaceId()"
          [mode]="mode()"
          [eventId]="eventId()"
          [presetAnchorType]="presetAnchorType()"
          [presetAnchorId]="presetAnchorId()"
          [ctgovLocked]="ctgovLocked()"
          (saved)="onSaved()"
          (cancelled)="visible.set(false)"
        />
      }
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFormDialogComponent {
  readonly spaceId = input.required<string>();
  readonly visible = model(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly eventId = input<string | null>(null);
  readonly presetAnchorType = input<AnchorType>('trial');
  readonly presetAnchorId = input<string | null>(null);
  readonly ctgovLocked = input(false);
  readonly saved = output<void>();

  protected onSaved(): void {
    this.saved.emit();
    this.visible.set(false);
  }
}
