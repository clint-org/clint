import { inject, Injectable } from '@angular/core';

import { SupabaseService } from './supabase.service';
import {
  DownloadMaterialResult,
  Material,
  MaterialEntityType,
  MaterialListResult,
  MaterialType,
  RegisterMaterialInput,
  UpdateMaterialInput,
} from '../models/material.model';

const MATERIALS_BUCKET = 'materials';
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Service wrapper around the materials registry RPCs and Supabase Storage.
 *
 * Upload flow:
 *   1. Caller picks a file. uploadFile() places it in the private
 *      `materials` bucket at materials/{space_id}/{tmp_id}/{file_name}.
 *   2. registerMaterial() inserts the row and links via RPC and returns
 *      the new material id.
 *   3. Caller may optionally repath the storage object so the final path
 *      contains the canonical material id; service.repath() handles that.
 *
 * Download flow:
 *   1. downloadMaterial() validates access via RPC (returns the storage
 *      path).
 *   2. Frontend calls storage.from(...).createSignedUrl(path, ttl) and
 *      hands the browser the resulting URL.
 */
@Injectable({ providedIn: 'root' })
export class MaterialService {
  private supabase = inject(SupabaseService);

  /** Generates a fresh `materials/{space_id}/{tmp_id}/{file_name}` path. */
  buildTempPath(spaceId: string, fileName: string): string {
    const tmp = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
    return `${spaceId}/${tmp}/${this.safeFileName(fileName)}`;
  }

  buildFinalPath(spaceId: string, materialId: string, fileName: string): string {
    return `${spaceId}/${materialId}/${this.safeFileName(fileName)}`;
  }

  private safeFileName(name: string): string {
    // Replace path separators and control chars; keep extensions intact.
    return name.replace(/[/\\]/g, '_');
  }

  /** Uploads the file to the private `materials` bucket. */
  async uploadFile(path: string, file: File): Promise<void> {
    const { error } = await this.supabase.client.storage.from(MATERIALS_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    if (error) throw error;
  }

  /**
   * Moves the storage object so the final path contains the canonical
   * material id. Best-effort: if the move fails we leave the temp path
   * (the row already references it).
   */
  async repath(fromPath: string, toPath: string): Promise<boolean> {
    if (fromPath === toPath) return true;
    const { error } = await this.supabase.client.storage
      .from(MATERIALS_BUCKET)
      .move(fromPath, toPath);
    if (error) return false;
    return true;
  }

  async registerMaterial(input: RegisterMaterialInput): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('register_material', {
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
    });
    if (error) throw error;
    return data as string;
  }

  /**
   * Updates the row's storage path. Only the uploader is allowed to do
   * this (RLS check on materials.update). Used after registerMaterial +
   * repath so the row points at the final, material-id-keyed path.
   */
  async updateFilePath(materialId: string, newPath: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('materials')
      .update({ file_path: newPath })
      .eq('id', materialId);
    if (error) throw error;
  }

  async listForEntity(opts: {
    entityType: MaterialEntityType;
    entityId: string;
    materialTypes?: MaterialType[] | null;
    limit?: number;
    offset?: number;
  }): Promise<MaterialListResult> {
    const { data, error } = await this.supabase.client.rpc('list_materials_for_entity', {
      p_entity_type: opts.entityType,
      p_entity_id: opts.entityId,
      p_material_types: opts.materialTypes ?? null,
      p_limit: opts.limit ?? 50,
      p_offset: opts.offset ?? 0,
    });
    if (error) throw error;
    return (data as MaterialListResult) ?? { rows: [] };
  }

  async listRecentForSpace(spaceId: string, limit = 5): Promise<Material[]> {
    const { data, error } = await this.supabase.client.rpc('list_recent_materials_for_space', {
      p_space_id: spaceId,
      p_limit: limit,
    });
    if (error) throw error;
    const result = (data as { rows: Material[] } | null) ?? { rows: [] };
    return result.rows ?? [];
  }

  async listForSpace(opts: {
    spaceId: string;
    materialTypes?: MaterialType[] | null;
    entityType?: MaterialEntityType | null;
    entityId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<MaterialListResult> {
    const { data, error } = await this.supabase.client.rpc('list_materials_for_space', {
      p_space_id: opts.spaceId,
      p_material_types: opts.materialTypes ?? null,
      p_entity_type: opts.entityType ?? null,
      p_entity_id: opts.entityId ?? null,
      p_limit: opts.limit ?? 100,
      p_offset: opts.offset ?? 0,
    });
    if (error) throw error;
    return (data as MaterialListResult) ?? { rows: [] };
  }

  async update(input: UpdateMaterialInput): Promise<void> {
    const { error } = await this.supabase.client.rpc('update_material', {
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
    });
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('delete_material', {
      p_id: id,
    });
    if (error) throw error;
    const result = data as { material_id: string; file_path: string } | null;
    if (result?.file_path) {
      // Best-effort storage cleanup. If this fails (race, retention),
      // the row is already gone -- the orphaned file will be cleaned up
      // by an external janitor.
      await this.supabase.client.storage.from(MATERIALS_BUCKET).remove([result.file_path]);
    }
  }

  /**
   * Validates access via RPC, then issues a short-lived signed URL via
   * the storage client. Keeps the access check server-side and the
   * signed-url issuance in the well-tested storage SDK.
   */
  async getDownloadUrl(materialId: string): Promise<{
    url: string;
    fileName: string;
    mimeType: string;
  }> {
    const { data: rpcData, error: rpcError } = await this.supabase.client.rpc('download_material', {
      p_material_id: materialId,
    });
    if (rpcError) throw rpcError;
    const meta = rpcData as DownloadMaterialResult;
    if (!meta?.file_path) throw new Error('Material not found');

    const { data: signed, error: signedError } = await this.supabase.client.storage
      .from(MATERIALS_BUCKET)
      .createSignedUrl(meta.file_path, SIGNED_URL_TTL_SECONDS, {
        download: meta.file_name,
      });
    if (signedError) throw signedError;
    if (!signed?.signedUrl) throw new Error('Could not create signed URL');

    return {
      url: signed.signedUrl,
      fileName: meta.file_name,
      mimeType: meta.mime_type,
    };
  }
}
