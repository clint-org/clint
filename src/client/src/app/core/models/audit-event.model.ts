export type AuditScopeKind = 'agency' | 'tenant' | 'space' | 'platform';

export type AuditSource = 'rpc' | 'trigger' | 'edge_function' | 'system';

export interface AuditEvent {
  id: string;
  occurred_at: string;
  action: string;
  source: AuditSource;
  rpc_name: string | null;

  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;

  actor_ip: string | null;
  actor_user_agent: string | null;
  request_id: string | null;

  agency_id: string | null;
  tenant_id: string | null;
  space_id: string | null;

  resource_type: string;
  resource_id: string | null;

  metadata: Record<string, unknown>;
}

export interface AuditEventFilter {
  actor_user_id?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditEventPage {
  limit: number;
  offset: number;
}
