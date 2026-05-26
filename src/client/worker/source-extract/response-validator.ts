import {
  ExtractionResultSchema,
  type ExtractionResult,
  type InventorySnapshot,
  type DroppedEntity,
} from './types';
import { isNameSubstring } from './name-validator';

export interface ValidationSuccess {
  ok: true;
  result: ExtractionResult;
  dropped: DroppedEntity[];
  warnings: string[];
}

export interface ValidationFailure {
  ok: false;
  reason: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateExtraction(
  rawJson: string,
  inventory: InventorySnapshot,
  sourceText: string,
): ValidationResult {
  let parsed: unknown;
  try {
    const cleaned = extractJsonBlock(rawJson);
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const zodResult = ExtractionResultSchema.safeParse(parsed);
  if (!zodResult.success) {
    const issues = zodResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, reason: `schema_invalid: ${issues}` };
  }

  const data = zodResult.data;
  const dropped: DroppedEntity[] = [];
  const warnings: string[] = [];

  // --- Step 3: Cross-ref bounds check ---

  const validAssetIndices = new Set<number>();
  for (let i = 0; i < data.assets.length; i++) {
    const asset = data.assets[i];
    if (asset.company_ref < 0 || asset.company_ref >= data.companies.length) {
      dropped.push({
        type: 'asset',
        index: i,
        name: asset.name,
        reason: `company_ref ${asset.company_ref} out of bounds`,
      });
    } else {
      validAssetIndices.add(i);
    }
  }

  const validTrialIndices = new Set<number>();
  for (let i = 0; i < data.trials.length; i++) {
    const trial = data.trials[i];
    if (trial.sponsor_ref < 0 || trial.sponsor_ref >= data.companies.length) {
      dropped.push({
        type: 'trial',
        index: i,
        name: trial.name,
        reason: `sponsor_ref ${trial.sponsor_ref} out of bounds`,
      });
      continue;
    }
    if (
      trial.asset_ref !== null &&
      (trial.asset_ref < 0 || trial.asset_ref >= data.assets.length)
    ) {
      dropped.push({
        type: 'trial',
        index: i,
        name: trial.name,
        reason: `asset_ref ${trial.asset_ref} out of bounds`,
      });
      continue;
    }
    validTrialIndices.add(i);
  }

  for (let i = 0; i < data.markers.length; i++) {
    const marker = data.markers[i];
    const bad = marker.trial_refs.find(
      (r) => r < 0 || r >= data.trials.length,
    );
    if (bad !== undefined) {
      dropped.push({
        type: 'marker',
        index: i,
        name: marker.title,
        reason: `trial_refs contains out-of-bounds index ${bad}`,
      });
    }
  }

  for (let i = 0; i < data.events.length; i++) {
    const event = data.events[i];
    const ref = event.anchor.ref;
    if (event.anchor.level === 'space') continue;
    if (ref === null) {
      dropped.push({
        type: 'event',
        index: i,
        name: event.title,
        reason: `anchor ref is null for level '${event.anchor.level}'`,
      });
      continue;
    }
    const limit =
      event.anchor.level === 'company'
        ? data.companies.length
        : event.anchor.level === 'asset'
          ? data.assets.length
          : data.trials.length;
    if (ref < 0 || ref >= limit) {
      dropped.push({
        type: 'event',
        index: i,
        name: event.title,
        reason: `anchor ref ${ref} out of bounds for level '${event.anchor.level}'`,
      });
    }
  }

  const droppedByTypeIndex = new Map<string, Set<number>>();
  for (const d of dropped) {
    const key = d.type;
    if (!droppedByTypeIndex.has(key)) droppedByTypeIndex.set(key, new Set());
    droppedByTypeIndex.get(key)!.add(d.index);
  }

  const isDropped = (type: DroppedEntity['type'], index: number) =>
    droppedByTypeIndex.get(type)?.has(index) ?? false;

  // --- Step 4: Existing-id check ---

  const inventoryIds: Record<string, Set<string>> = {
    company: new Set(inventory.companies.map((c) => c.id)),
    asset: new Set(inventory.assets.map((a) => a.id)),
    trial: new Set(inventory.trials.map((t) => t.id)),
  };

  function checkExistingId(
    entity: { match: { kind: string; id?: string; name?: string } },
    type: 'company' | 'asset' | 'trial',
    index: number,
  ): void {
    if (isDropped(type, index)) return;
    if (entity.match.kind !== 'existing') return;
    const ids = inventoryIds[type];
    if (!ids.has(entity.match.id!)) {
      warnings.push(
        `${type}[${index}] claimed existing id ${entity.match.id} not found in inventory; demoted to new`,
      );
      (entity as any).match = { kind: 'new', name: '???' };
    }
  }

  data.companies.forEach((c, i) => checkExistingId(c, 'company', i));
  data.assets.forEach((a, i) => checkExistingId(a, 'asset', i));
  data.trials.forEach((t, i) => checkExistingId(t, 'trial', i));

  // --- Step 5: Name-substring rule ---

  // Track which entities are "grounded" (existing or name-validated new)
  const groundedCompany = new Set<number>();
  const groundedAsset = new Set<number>();
  const groundedTrial = new Set<number>();

  for (let i = 0; i < data.companies.length; i++) {
    if (isDropped('company', i)) continue;
    const c = data.companies[i];
    if (c.match.kind === 'existing') {
      groundedCompany.add(i);
    } else if (isNameSubstring(c.match.name, sourceText)) {
      groundedCompany.add(i);
    } else {
      dropped.push({
        type: 'company',
        index: i,
        name: c.match.name,
        reason: 'name not found in source text',
      });
      droppedByTypeIndex.get('company')?.add(i) ??
        droppedByTypeIndex.set('company', new Set([i]));
    }
  }

  for (let i = 0; i < data.assets.length; i++) {
    if (isDropped('asset', i)) continue;
    const a = data.assets[i];
    if (a.match.kind === 'existing') {
      groundedAsset.add(i);
    } else {
      const nameOk = isNameSubstring(a.match.name, sourceText);
      const genericOk =
        a.generic_name !== null &&
        isNameSubstring(a.generic_name, sourceText);
      if (nameOk || genericOk) {
        groundedAsset.add(i);
      } else {
        dropped.push({
          type: 'asset',
          index: i,
          name: a.name,
          reason: 'neither name nor generic_name found in source text',
        });
        droppedByTypeIndex.get('asset')?.add(i) ??
          droppedByTypeIndex.set('asset', new Set([i]));
      }
    }
  }

  for (let i = 0; i < data.trials.length; i++) {
    if (isDropped('trial', i)) continue;
    const t = data.trials[i];
    if (t.match.kind === 'existing') {
      groundedTrial.add(i);
    } else if (isNameSubstring(t.match.name, sourceText)) {
      groundedTrial.add(i);
    } else {
      dropped.push({
        type: 'trial',
        index: i,
        name: t.name,
        reason: 'name not found in source text',
      });
      droppedByTypeIndex.get('trial')?.add(i) ??
        droppedByTypeIndex.set('trial', new Set([i]));
    }
  }

  for (let i = 0; i < data.markers.length; i++) {
    if (isDropped('marker', i)) continue;
    const marker = data.markers[i];
    const hasGroundedTrial = marker.trial_refs.some((ref) =>
      groundedTrial.has(ref),
    );
    if (!hasGroundedTrial) {
      dropped.push({
        type: 'marker',
        index: i,
        name: marker.title,
        reason: 'no trial_refs point to a grounded trial',
      });
      droppedByTypeIndex.get('marker')?.add(i) ??
        droppedByTypeIndex.set('marker', new Set([i]));
    }
  }

  for (let i = 0; i < data.events.length; i++) {
    if (isDropped('event', i)) continue;
    const event = data.events[i];
    if (event.anchor.level === 'space') continue;
    const ref = event.anchor.ref!;
    const grounded =
      event.anchor.level === 'company'
        ? groundedCompany.has(ref)
        : event.anchor.level === 'asset'
          ? groundedAsset.has(ref)
          : groundedTrial.has(ref);
    if (!grounded) {
      dropped.push({
        type: 'event',
        index: i,
        name: event.title,
        reason: `anchor ref ${ref} points to a dropped ${event.anchor.level}`,
      });
      droppedByTypeIndex.get('event')?.add(i) ??
        droppedByTypeIndex.set('event', new Set([i]));
    }
  }

  // --- Step 6: Build cleaned result ---

  const cleanedResult: ExtractionResult = {
    source_summary: data.source_summary,
    source_title: data.source_title,
    source_date: data.source_date,
    companies: data.companies.filter((_, i) => !isDropped('company', i)),
    assets: data.assets.filter((_, i) => !isDropped('asset', i)),
    trials: data.trials.filter((_, i) => !isDropped('trial', i)),
    markers: data.markers.filter((_, i) => !isDropped('marker', i)),
    events: data.events.filter((_, i) => !isDropped('event', i)),
  };

  return { ok: true, result: cleanedResult, dropped, warnings };
}

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}
