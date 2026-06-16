/**
 * Stroke outline for a timeline phase bar. Closed edges are stroked; an open
 * edge (the phase starts before the window, or is ongoing / ends after it) is
 * left without a vertical cap so the bar reads as continuing beyond the window
 * rather than being cut flat. Pure geometry so it can be unit-tested.
 */
export function phaseOutlinePath(
  x: number,
  width: number,
  y: number,
  height: number,
  cornerRadius: number,
  openLeft: boolean,
  openRight: boolean
): string {
  if (width <= 0) return '';
  const r = Math.min(cornerRadius, width / 2, height / 2);
  const x2 = x + width;
  const yb = y + height;

  if (!openLeft && !openRight) {
    return `M ${x + r},${y} L ${x2 - r},${y} Q ${x2},${y} ${x2},${y + r} L ${x2},${yb - r} Q ${x2},${yb} ${x2 - r},${yb} L ${x + r},${yb} Q ${x},${yb} ${x},${yb - r} L ${x},${y + r} Q ${x},${y} ${x + r},${y} Z`;
  }
  if (openLeft && !openRight) {
    return `M ${x},${y} L ${x2 - r},${y} Q ${x2},${y} ${x2},${y + r} L ${x2},${yb - r} Q ${x2},${yb} ${x2 - r},${yb} L ${x},${yb}`;
  }
  if (!openLeft && openRight) {
    return `M ${x2},${y} L ${x + r},${y} Q ${x},${y} ${x},${y + r} L ${x},${yb - r} Q ${x},${yb} ${x + r},${yb} L ${x2},${yb}`;
  }
  // Both edges open: stroke only the top and bottom rails.
  return `M ${x},${y} L ${x2},${y} M ${x},${yb} L ${x2},${yb}`;
}
