/**
 * Builds an absolute-path URL for an in-page section anchor, preserving the
 * current route path and query string before the fragment.
 *
 * Passing a bare `#id` to history.replaceState resolves it against the document
 * base URL (`<base href="/">`), which drops the route and leaves `/#id`. Keeping
 * the pathname + search makes the fragment update relative to the actual page.
 */
export function sectionHashUrl(pathname: string, search: string, id: string): string {
  return `${pathname}${search}#${id}`;
}
