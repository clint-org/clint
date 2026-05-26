import jaroWinkler from 'jaro-winkler';
import type { FuzzyAlternate, InventorySnapshot } from './types';

const SIMILARITY_THRESHOLD = 0.7;
const MAX_ALTERNATES = 3;

type EntityType = 'company' | 'asset' | 'trial';

export interface NewEntity {
  type: EntityType;
  index: number;
  name: string;
}

function getInventoryItems(
  inventory: InventorySnapshot,
  type: EntityType,
): { id: string; name: string }[] {
  switch (type) {
    case 'company':
      return inventory.companies;
    case 'asset':
      return inventory.assets;
    case 'trial':
      return inventory.trials;
  }
}

export function computeFuzzyAlternates(
  newEntities: NewEntity[],
  inventory: InventorySnapshot,
): Record<string, FuzzyAlternate[]> {
  const result: Record<string, FuzzyAlternate[]> = {};

  for (const entity of newEntities) {
    const items = getInventoryItems(inventory, entity.type);
    const entityLower = entity.name.toLowerCase();

    const scored = items
      .map((item) => ({
        id: item.id,
        name: item.name,
        score: jaroWinkler(entityLower, item.name.toLowerCase()),
      }))
      .filter((alt) => alt.score > SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ALTERNATES);

    if (scored.length > 0) {
      result[`${entity.type}_${entity.index}`] = scored;
    }
  }

  return result;
}
