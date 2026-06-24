import { inject, Injectable } from '@angular/core';

import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';
import {
  Material,
  MaterialEntityType,
  MaterialListResult,
  MaterialType,
  RegisterMaterialInput,
  UpdateMaterialInput,
} from '../models/material.model';

const WORKER_BASE = '/api/materials';
const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/**
 * Service wrapper around the materials registry RPCs and the R2 Worker.
 *
 * Upload flow:
 *   1. registerMaterial() inserts the row (finalized_at IS NULL, hidden
 *      from readers) and returns the new material id.
 *   2. uploadFile() asks the worker for a presigned R2 PUT URL, then
 *      PUTs the bytes directly to R2.
 *   3. updateFilePathDirect() writes the canonical R2 key to the row.
 *   4. finalize() flips finalized_at, making the row visible.
 *
 * Download flow:
 *   getDownloadUrl() asks the worker to sign a GET URL. The worker
 *   validates access via the download_material RPC, then returns a
 *   presigned R2 URL with a Content-Disposition: attachment header.
 */
@Injectable({ providedIn: 'root' })
export class MaterialService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  /**
   * Asks the worker for a presigned R2 PUT URL, then uploads the file
   * directly to R2. Caller must have already called registerMaterial()
   * to obtain materialId.
   */
  async uploadFile(materialId: string, file: File): Promise<void> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const token = session.session?.access_token;
    if (!token) throw new Error('Not signed in');

    const signRes = await fetch(`${WORKER_BASE}/sign-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ material_id: materialId }),
    });
    if (!signRes.ok) {
      const body = await safeJson(signRes);
      throw new Error(body?.error ?? `Upload sign failed (${signRes.status})`);
    }
    const { url } = (await signRes.json()) as { url: string; key: string };

    const putRes = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!putRes.ok) {
      throw new Error(`Upload to R2 failed (${putRes.status})`);
    }
  }

  /** Mark the row as finalized so list/download RPCs surface it. */
  async finalize(materialId: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('materials')
      .select('space_id, material_links(entity_type, entity_id)')
      .eq('id', materialId)
      .single();
    await this.supabase.client
      .rpc('finalize_material', {
        p_material_id: materialId,
      })
      .throwOnError();
    if (existing?.space_id) {
      const tags: string[] = [
        `space:${existing.space_id}:materials`,
        `space:${existing.space_id}:activity`,
      ];
      const links = (existing.material_links ?? []) as { entity_type: string; entity_id: string }[];
      for (const l of links) tags.push(`entity:${l.entity_type}:${l.entity_id}:materials`);
      this.cache.invalidateTags(tags);
    }
  }

  /**
   * Asks the worker for a presigned R2 GET URL with a download
   * Content-Disposition. The worker validates access via the existing
   * download_material RPC.
   */
  async getDownloadUrl(materialId: string): Promise<{
    url: string;
    fileName: string;
    mimeType: string;
  }> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const token = session.session?.access_token;
    if (!token) throw new Error('Not signed in');

    const res = await fetch(`${WORKER_BASE}/sign-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ material_id: materialId }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw new Error(body?.error ?? `Download sign failed (${res.status})`);
    }
    const body = (await res.json()) as { url: string; file_name: string; mime_type: string };
    return { url: body.url, fileName: body.file_name, mimeType: body.mime_type };
  }

  async registerMaterial(input: RegisterMaterialInput): Promise<string> {
    const { data } = await this.supabase.client
      .rpc('register_material', {
        p_space_id: input.space_id,
        p_file_path: input.file_path,
        p_file_name: input.file_name,
        p_file_size_bytes: input.file_size_bytes,
        p_mime_type: input.mime_type,
        p_material_type: input.material_type,
        p_title: input.title,
        p_links: input.links.map((l, i) => ({
          entity_type: l.entity_type,
          entity_id: l.entity_id,
          display_order: l.display_order ?? i,
        })),
      })
      .throwOnError();
    const tags: string[] = [
      `space:${input.space_id}:materials`,
      `space:${input.space_id}:activity`,
    ];
    for (const link of input.links) {
      tags.push(`entity:${link.entity_type}:${link.entity_id}:materials`);
    }
    this.cache.invalidateTags(tags);
    return data as string;
  }

  /**
   * Best-effort rollback of an orphaned registration. The upload flow
   * registers the row before the file is confirmed in R2; if a later step
   * fails, this removes the never-finalized row so it does not linger. The
   * RPC no-ops on a finalized row or another user's row, so callers can
   * invoke it from a catch handler without further guarding.
   */
  async discardPending(materialId: string): Promise<void> {
    await this.supabase.client
      .rpc('discard_pending_material', { p_material_id: materialId })
      .throwOnError();
  }

  /**
   * Updates materials.file_path directly via PostgREST (RLS enforces
   * uploader-only). Called from the upload flow after the R2 PUT
   * succeeds, so the canonical R2 key is what download_material
   * surfaces.
   */
  async updateFilePathDirect(materialId: string, newPath: string): Promise<void> {
    await this.supabase.client
      .from('materials')
      .update({ file_path: newPath })
      .eq('id', materialId)
      .throwOnError();
  }

  async listForEntity(opts: {
    entityType: MaterialEntityType;
    entityId: string;
    materialTypes?: MaterialType[] | null;
    limit?: number;
    offset?: number;
  }): Promise<MaterialListResult> {
    return this.cache.get('list_materials_for_entity', opts, {
      ttl: HEAVY_TTL,
      tags: [`entity:${opts.entityType}:${opts.entityId}:materials`],
      fetch: async () => {
        const { data } = await this.supabase.client
          .rpc('list_materials_for_entity', {
            p_entity_type: opts.entityType,
            p_entity_id: opts.entityId,
            p_material_types: opts.materialTypes ?? null,
            p_limit: opts.limit ?? 50,
            p_offset: opts.offset ?? 0,
          })
          .throwOnError();
        return (data as MaterialListResult) ?? { rows: [] };
      },
    });
  }

  async listRecentForSpace(spaceId: string, limit = 5): Promise<Material[]> {
    return this.cache.get(
      'list_recent_materials_for_space',
      { spaceId, limit },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:materials`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('list_recent_materials_for_space', {
              p_space_id: spaceId,
              p_limit: limit,
            })
            .throwOnError();
          const result = (data as { rows: Material[] } | null) ?? { rows: [] };
          return result.rows ?? [];
        },
      }
    );
  }

  async listForSpace(opts: {
    spaceId: string;
    materialTypes?: MaterialType[] | null;
    entityType?: MaterialEntityType | null;
    entityId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<MaterialListResult> {
    return this.cache.get('list_materials_for_space', opts, {
      ttl: HEAVY_TTL,
      tags: [`space:${opts.spaceId}:materials`],
      fetch: async () => {
        const { data } = await this.supabase.client
          .rpc('list_materials_for_space', {
            p_space_id: opts.spaceId,
            p_material_types: opts.materialTypes ?? null,
            p_entity_type: opts.entityType ?? null,
            p_entity_id: opts.entityId ?? null,
            p_limit: opts.limit ?? 100,
            p_offset: opts.offset ?? 0,
          })
          .throwOnError();
        return (data as MaterialListResult) ?? { rows: [] };
      },
    });
  }

  async update(input: UpdateMaterialInput): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('materials')
      .select('space_id, material_links(entity_type, entity_id)')
      .eq('id', input.id)
      .single();
    await this.supabase.client
      .rpc('update_material', {
        p_id: input.id,
        p_title: input.title ?? null,
        p_material_type: input.material_type ?? null,
        p_links:
          input.links === null || input.links === undefined
            ? null
            : input.links.map((l, i) => ({
                entity_type: l.entity_type,
                entity_id: l.entity_id,
                display_order: l.display_order ?? i,
              })),
      })
      .throwOnError();
    if (existing?.space_id) {
      const tags: string[] = [
        `space:${existing.space_id}:materials`,
        `space:${existing.space_id}:activity`,
      ];
      const links = (existing.material_links ?? []) as { entity_type: string; entity_id: string }[];
      for (const l of links) tags.push(`entity:${l.entity_type}:${l.entity_id}:materials`);
      this.cache.invalidateTags(tags);
    }
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('materials')
      .select('space_id, material_links(entity_type, entity_id)')
      .eq('id', id)
      .single();
    await this.supabase.client
      .rpc('delete_material', {
        p_id: id,
      })
      .throwOnError();
    if (existing?.space_id) {
      const tags: string[] = [
        `space:${existing.space_id}:materials`,
        `space:${existing.space_id}:activity`,
      ];
      const links = (existing.material_links ?? []) as { entity_type: string; entity_id: string }[];
      for (const l of links) tags.push(`entity:${l.entity_type}:${l.entity_id}:materials`);
      this.cache.invalidateTags(tags);
    }
  }
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}
