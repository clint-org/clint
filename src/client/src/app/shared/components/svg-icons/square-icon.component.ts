import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../../../core/models/marker-visual';

@Component({
  selector: 'g[app-square-icon]',
  standalone: true,
  template: `
    <svg:rect
      [attr.x]="padding()"
      [attr.y]="padding()"
      [attr.width]="innerSize()"
      [attr.height]="innerSize()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? S.shape : 0"
    />
    @if (innerMark() === 'x') {
      <svg:line
        [attr.x1]="size() * R.squareXMin"
        [attr.y1]="size() * R.squareXMin"
        [attr.x2]="size() * R.squareXMax"
        [attr.y2]="size() * R.squareXMax"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
      />
      <svg:line
        [attr.x1]="size() * R.squareXMax"
        [attr.y1]="size() * R.squareXMin"
        [attr.x2]="size() * R.squareXMin"
        [attr.y2]="size() * R.squareXMax"
        [attr.stroke]="markColor()"
        [attr.stroke-width]="S.innerMark"
        stroke-linecap="round"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SquareIconComponent {
  readonly size = input<number>(16);
  readonly color = input<string>('#000000');
  readonly fillStyle = input<FillStyle>('filled');
  readonly innerMark = input<InnerMark>('none');

  protected readonly R = GLYPH_RATIOS;
  protected readonly S = GLYPH_STROKES;

  readonly padding = computed(() => this.size() * this.R.squareInset);
  readonly innerSize = computed(() => this.size() * (1 - 2 * this.R.squareInset));
  readonly markColor = computed(() => (this.fillStyle() === 'outline' ? this.color() : 'white'));
}
