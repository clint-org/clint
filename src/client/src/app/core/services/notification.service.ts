import { inject, Injectable } from '@angular/core';

import { MarkerNotification } from '../models/notification.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private supabase = inject(SupabaseService);

  async createNotification(
    spaceId: string,
    markerId: string,
    priority: 'low' | 'high',
    summary: string
  ): Promise<void> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { error } = await this.supabase.client
      .from('marker_notifications')
      .insert({
        space_id: spaceId,
        marker_id: markerId,
        priority,
        summary,
        created_by: userId,
      });
    if (error) throw error;
  }

  async getNotifications(spaceId: string): Promise<MarkerNotification[]> {
    const { data, error } = await this.supabase.client
      .rpc('get_notifications', { p_space_id: spaceId });
    if (error) throw error;
    return (data ?? []) as MarkerNotification[];
  }

  async getUnreadCount(spaceId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .rpc('get_unread_notification_count', { p_space_id: spaceId });
    if (error) throw error;
    return (data ?? 0) as number;
  }

  async markAsRead(notificationId: string): Promise<void> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { error } = await this.supabase.client
      .from('notification_reads')
      .insert({
        notification_id: notificationId,
        user_id: userId,
      });
    if (error) throw error;
  }
}
