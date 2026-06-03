import { Pipe, PipeTransform } from '@angular/core';

/**
 * Maps an entity-level value to its user-facing noun. The data model stores
 * the asset level as `product` (see `EntityLevel`), but every surface the
 * analyst reads should say "asset". Trial / company / space pass through
 * unchanged. Pure so it is safe in `@for` rows.
 */
@Pipe({ name: 'entityNoun' })
export class EntityNounPipe implements PipeTransform {
  transform(level: string | null | undefined): string {
    return level === 'product' ? 'asset' : (level ?? '');
  }
}
