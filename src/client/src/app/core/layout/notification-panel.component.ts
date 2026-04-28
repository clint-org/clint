import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { NotificationService } from '../services/notification.service';
import { MarkerNotification } from '../models/notification.model';
import { Select } from 'primeng/select';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [DatePipe, NgClass, Select, FormsModule],
  template: `
    <div
      class="absolute right-0 top-full mt-2 w-96 max-h-[480px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 flex flex-col"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span class="text-sm font-semibold text-slate-800 tracking-wide uppercase">Notifications</span>
        <div class="flex items-center gap-2">
          <p-select
            [options]="filterOptions"
            [(ngModel)]="activeFilter"
            (ngModelChange)="applyFilter()"
            optionLabel="label"
            optionValue="value"
            size="small"
          />
          <button (click)="closed.emit()" class="text-slate-400 hover:text-slate-600 p-1">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="overflow-y-auto flex-1">
        @for (n of filteredNotifications(); track n.id) {
          <div
            class="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
            [ngClass]="{ 'bg-brand-50': !n.is_read }"
            role="button"
            tabindex="0"
            (click)="onNotificationClick(n)"
            (keydown.enter)="onNotificationClick(n)"
            (keydown.space)="onNotificationClick(n)"
          >
            <div class="flex items-center gap-2 mb-1">
              @if (n.priority === 'high') {
                <span class="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">High</span>
              }
              @if (n.marker?.marker_types?.marker_categories?.name; as catName) {
                <span class="text-[10px] uppercase tracking-wider text-slate-500">{{ catName }}</span>
              }
              <span class="text-[10px] text-slate-400 ml-auto">{{ n.created_at | date:'MMM d, h:mm a' }}</span>
            </div>
            <div class="text-sm font-medium text-slate-800">{{ n.marker?.title }}</div>
            <div class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ n.summary }}</div>
          </div>
        } @empty {
          <div class="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
        }
      </div>
    </div>
  `,
})
export class NotificationPanelComponent implements OnInit {
  readonly spaceId = input.required<string>();
  readonly closed = output<void>();
  readonly read = output<void>();

  private notificationService = inject(NotificationService);

  notifications = signal<MarkerNotification[]>([]);
  filteredNotifications = signal<MarkerNotification[]>([]);
  activeFilter = 'all';

  readonly filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Unread', value: 'unread' },
    { label: 'High Priority', value: 'high' },
  ];

  async ngOnInit() {
    const data = await this.notificationService.getNotifications(this.spaceId());
    this.notifications.set(data);
    this.applyFilter();
  }

  applyFilter() {
    const all = this.notifications();
    switch (this.activeFilter) {
      case 'unread':
        this.filteredNotifications.set(all.filter(n => !n.is_read));
        break;
      case 'high':
        this.filteredNotifications.set(all.filter(n => n.priority === 'high'));
        break;
      default:
        this.filteredNotifications.set(all);
    }
  }

  async onNotificationClick(n: MarkerNotification) {
    if (!n.is_read) {
      await this.notificationService.markAsRead(n.id);
      n.is_read = true;
      this.read.emit();
    }
  }
}
