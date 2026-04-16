import { animate, style, transition, trigger } from '@angular/animations';

export const fadeTooltipAnimation = trigger('fadeTooltip', [
  transition(':enter', [
    style({ opacity: 0 }),
    animate('120ms ease-out', style({ opacity: 1 })),
  ]),
  transition(':leave', [
    animate('80ms ease-in', style({ opacity: 0 })),
  ]),
]);
