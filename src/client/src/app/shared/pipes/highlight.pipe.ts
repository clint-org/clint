import { Pipe, PipeTransform } from '@angular/core';

import { highlightPlain } from '../utils/highlight-search';

/**
 * Wraps occurrences of `query` in `text` with `<mark class="search-hit">`,
 * after HTML-escaping the input. Bind via `[innerHTML]`. Used by grid
 * cells whose row matched a global search; styled by the global
 * `mark.search-hit` rule in styles.css.
 */
@Pipe({ name: 'highlight', standalone: true })
export class HighlightPipe implements PipeTransform {
  transform(text: string | null | undefined, query: string | null | undefined): string {
    return highlightPlain(text ?? '', query);
  }
}
