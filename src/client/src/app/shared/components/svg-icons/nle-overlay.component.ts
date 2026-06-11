import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-nle-overlay]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="0"
      [attr.y1]="size() / 2"
      [attr.x2]="size()"
      [attr.y2]="size() / 2"
      stroke="#64748b"
      [attr.stroke-width]="S.nleStrike"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NleOverlayComponent {
  readonly size = input<number>(16);

  protected readonly S = GLYPH_STROKES;
}
