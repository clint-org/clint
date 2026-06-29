import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-flag-icon]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="poleX()"
      [attr.y1]="1"
      [attr.x2]="poleX()"
      [attr.y2]="size() - 1"
      [attr.stroke]="color()"
      [attr.stroke-width]="S.shape"
      stroke-linecap="round"
    />
    <svg:path
      [attr.d]="flagPath()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? S.flagBannerOutline : S.flagBannerFilled"
      [attr.stroke-dasharray]="outlineDash() ? dashPattern : null"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlagIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly outlineDash = input<boolean>(false);

  protected readonly S = GLYPH_STROKES;
  protected readonly dashPattern = GLYPH_STROKES.outlineDashPattern.join(',');

  readonly poleX = computed(() => this.size() * GLYPH_RATIOS.flagPoleX);

  readonly flagPath = computed(() => {
    const s = this.size();
    const px = this.poleX();
    const fw = s * GLYPH_RATIOS.flagWidth;
    const fh = s * GLYPH_RATIOS.flagHeight;
    const cp1y = fh * 0.3;
    const cp2y = fh * 0.7;
    return `M${px},1 Q${px + fw * 0.5},${1 + cp1y} ${px + fw},${1} L${px + fw},${1 + fh} Q${px + fw * 0.5},${1 + cp2y} ${px},${1 + fh} Z`;
  });
}
