import { inject, Injectable } from '@angular/core';

import { Marker } from '../models/marker.model';
import { Trial } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

const TRIAL_SELECT = `
  *,
  therapeutic_areas(*),
  marker_assignments(
    id,
    marker_id,
    trial_id,
    created_at,
    markers(
      *,
      marker_types(*, marker_categories(*))
    )
  ),
  trial_notes(*)
`;

/** Flatten marker_assignments[].markers into trial.markers[] */
function normalizeTrial(raw: Record<string, unknown>): Trial {
  const assignments = (raw['marker_assignments'] as { markers: Marker }[] | null) ?? [];
  const markers: Marker[] = assignments
    .map(a => a.markers)
    .filter((m): m is Marker => !!m);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { marker_assignments: _unused, ...rest } = raw;
  return { ...rest, markers } as unknown as Trial;
}

@Injectable({ providedIn: 'root' })
export class TrialService {
  private supabase = inject(SupabaseService);

  async listByProduct(productId: string): Promise<Trial[]> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('product_id', productId)
      .order('display_order');
    if (error) throw error;
    return (data as Record<string, unknown>[]).map(normalizeTrial);
  }

  async listBySpace(spaceId: string): Promise<Trial[]> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('space_id', spaceId)
      .order('display_order');
    if (error) throw error;
    return (data as Record<string, unknown>[]).map(normalizeTrial);
  }

  async getById(id: string): Promise<Trial> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;
    return normalizeTrial(data as Record<string, unknown>);
  }

  async create(spaceId: string, trial: Partial<Trial>): Promise<Trial> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('trials')
      .insert({ ...trial, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Trial;
  }

  async getLatestSnapshot(
    trialId: string
  ): Promise<{ payload: unknown; fetched_at: string } | null> {
    const { data, error } = await this.supabase.client
      .from('trial_ctgov_snapshots')
      .select('payload, fetched_at')
      .eq('trial_id', trialId)
      .order('ctgov_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(id: string, changes: Partial<Trial>): Promise<Trial> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Trial;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('trials').delete().eq('id', id);
    if (error) throw error;
  }
}
