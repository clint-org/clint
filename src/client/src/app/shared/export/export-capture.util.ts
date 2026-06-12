/** Marks DOM subtrees that must not appear in exported images (e.g. help links). */
export const EXPORT_EXCLUDE_ATTR = 'data-export-exclude';

/** Marks DOM nodes whose presence means async content is still loading. */
export const EXPORT_WAITING_SELECTOR = '[data-export-waiting]';

/**
 * modern-screenshot filter callback: returning false drops the node and its
 * subtree from the capture. Duck-typed (not instanceof Element) so the check
 * works on any node kind and stays testable outside a DOM environment.
 */
export function includeInCapture(node: Node): boolean {
  const el = node as Element;
  return !(typeof el.hasAttribute === 'function' && el.hasAttribute(EXPORT_EXCLUDE_ATTR));
}
