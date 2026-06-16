/**
 * Roving-tabindex keyboard navigation for the segmented control (radiogroup
 * pattern). Returns the next option index for a key, or null when the key is
 * not a navigation key (so the caller leaves the event alone). Both axes are
 * accepted because the control is vertical but arrow semantics should still
 * feel natural to left/right pressers. Movement wraps.
 */
export function nextSegmentIndex(key: string, current: number, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (current + 1) % length;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (current - 1 + length) % length;
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}
