import { Injectable, inject } from '@angular/core';

import { SpaceService } from '../../core/services/space.service';
import { buildExportFilename, buildExportStem } from './export-filename';

/**
 * Builds descriptive `{space}-{view}-{date}.{ext}` download names for the
 * export surfaces (timeline, bullseye, heatmap). Resolving the space name
 * never blocks the export: a lookup failure degrades to a name without the
 * space segment. (P1.1 / UI-21.)
 */
@Injectable({ providedIn: 'root' })
export class ExportNamingService {
  private readonly spaceService = inject(SpaceService);

  private async resolveSpaceName(spaceId: string): Promise<string> {
    if (!spaceId) return '';
    try {
      return (await this.spaceService.getSpace(spaceId)).name ?? '';
    } catch {
      return '';
    }
  }

  async filename(spaceId: string, view: string, ext: 'png' | 'pptx' | 'xlsx'): Promise<string> {
    const space = await this.resolveSpaceName(spaceId);
    return buildExportFilename({ space, view, ext, date: new Date() });
  }

  /** Filename without extension, for export paths that append their own. */
  async stem(spaceId: string, view: string): Promise<string> {
    const space = await this.resolveSpaceName(spaceId);
    return buildExportStem({ space, view, date: new Date() });
  }
}
