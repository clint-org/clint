import { inject, Injectable } from '@angular/core';

import { AuditEvent, AuditEventFilter, AuditEventPage, AuditScopeKind } from '../models/audit-event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuditEventService {
  private readonly supabase = inject(SupabaseService);

  async list(
    scopeKind: AuditScopeKind,
    scopeId: string | null,
    filter: AuditEventFilter,
    page: AuditEventPage,
  ): Promise<AuditEvent[]> {
    const { data, error } = await this.supabase.client.rpc('list_audit_events', {
      p_scope_kind: scopeKind,
      p_scope_id: scopeId,
      p_actor_user_id: filter.actor_user_id ?? null,
      p_action: filter.action ?? null,
      p_from: filter.from ?? null,
      p_to: filter.to ?? null,
      p_limit: page.limit,
      p_offset: page.offset,
    });
    if (error) throw error;
    return (data ?? []) as AuditEvent[];
  }

  async exportCsv(
    scopeKind: AuditScopeKind,
    scopeId: string | null,
    filter: AuditEventFilter,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('export_audit_events_csv', {
      p_scope_kind: scopeKind,
      p_scope_id: scopeId,
      p_actor_user_id: filter.actor_user_id ?? null,
      p_action: filter.action ?? null,
      p_from: filter.from ?? null,
      p_to: filter.to ?? null,
    });
    if (error) throw error;
    return (data as string) ?? '';
  }

  downloadCsv(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
