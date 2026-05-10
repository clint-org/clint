import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-color-swatch',
  standalone: true,
  template: `
    <span
      [class]="'inline-block rounded-full border border-slate-300 ' + size()"
      [style.background-color]="color()"
      [attr.aria-label]="'Color: ' + color()"
      role="img"
    ></span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorSwatchComponent {
  readonly color = input.required<string>();
  readonly size = input('h-5 w-5');
}
