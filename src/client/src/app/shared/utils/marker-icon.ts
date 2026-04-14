import { MarkerType } from '../../core/models/marker.model';

export function getMarkerIcon(
  shape: MarkerType['shape'],
  fillStyle: MarkerType['fill_style']
): string {
  switch (shape) {
    case 'circle':
      return fillStyle === 'outline' ? 'fa-regular fa-circle' : 'fa-solid fa-circle';
    case 'diamond':
      return fillStyle === 'outline' ? 'fa-regular fa-gem' : 'fa-solid fa-gem';
    case 'flag':
      return fillStyle === 'outline' ? 'fa-regular fa-flag' : 'fa-solid fa-flag';
    case 'triangle':
      return 'fa-solid fa-play fa-rotate-270';
    case 'square':
      return fillStyle === 'outline' ? 'fa-regular fa-square' : 'fa-solid fa-square';
    case 'dashed-line':
      return 'fa-solid fa-grip-lines';
    default:
      return 'fa-solid fa-circle';
  }
}
