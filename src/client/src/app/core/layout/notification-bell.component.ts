import { Component, inject, input, signal, effect } from '@angular/core';
import { NotificationService } from '../services/notification.service';
import { NotificationPanelComponent } from './notification-panel.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [NotificationPanelComponent],
  template: `
    <div class="relative">
      <button
        (click)="panelOpen.set(!panelOpen())"
        class="relative p-2 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label="Notifications"
      >
        <i class="fa-regular fa-bell text-lg"></i>
        @if (unreadCount() > 0) {
          <span
            class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1"
          >
            {{ unreadCount() > 99 ? '99+' : unreadCount() }}
          </span>
        }
      </button>

      @if (panelOpen()) {
        <app-notification-panel
          [spaceId]="spaceId()"
          (closed)="panelOpen.set(false)"
          (read)="loadUnreadCount()"
        />
      }
    </div>
  `,
})
export class NotificationBellComponent {
  readonly spaceId = input.required<string>();
  private notificationService = inject(NotificationService);

  panelOpen = signal(false);
  unreadCount = signal(0);

  constructor() {
    effect(() => {
      const sid = this.spaceId();
      if (sid) this.loadUnreadCount();
    });
  }

  async loadUnreadCount() {
    const count = await this.notificationService.getUnreadCount(this.spaceId());
    this.unreadCount.set(count);
  }
}
