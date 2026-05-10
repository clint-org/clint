import { Component, input } from '@angular/core';

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
      stroke-width="2.5"
    />
  `,
})
export class NleOverlayComponent {
  readonly size = input<number>(16);
}
