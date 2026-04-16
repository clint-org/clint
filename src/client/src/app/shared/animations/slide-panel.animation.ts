import { animate, style, transition, trigger } from '@angular/animations';

export const slidePanelAnimation = trigger('slidePanel', [
  transition(':enter', [
    style({ transform: 'translateX(100%)', opacity: 0.5 }),
    animate('200ms ease-out', style({ transform: 'translateX(0)', opacity: 1 })),
  ]),
  transition(':leave', [
    animate('150ms ease-in', style({ transform: 'translateX(100%)', opacity: 0.5 })),
  ]),
]);
