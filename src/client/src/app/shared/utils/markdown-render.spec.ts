import { describe, expect, it } from 'vitest';
import { renderMarkdownInline } from './markdown-render';

describe('renderMarkdownInline', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdownInline('')).toBe('');
    expect(renderMarkdownInline('   \n  ')).toBe('');
  });

  it('wraps single paragraphs in <p>', () => {
    expect(renderMarkdownInline('hello world')).toBe('<p>hello world</p>');
  });

  it('renders bold and italic inline marks', () => {
    expect(renderMarkdownInline('**bold** and *em*')).toBe(
      '<p><strong>bold</strong> and <em>em</em></p>'
    );
  });

  it('renders a tight bullet list', () => {
    const md = '* one\n* two\n* three';
    expect(renderMarkdownInline(md)).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
  });

  it('renders a loose bullet list as a single list (blank lines between items)', () => {
    // ProseMirror's defaultMarkdownSerializer emits loose lists. Make sure the
    // renderer treats blank lines between same-type items as part of one list.
    const md = '* 1\n\n* 2\n\n* 3';
    expect(renderMarkdownInline(md)).toBe('<ul><li>1</li><li>2</li><li>3</li></ul>');
  });

  it('renders a loose ordered list as a single list', () => {
    const md = '1. one\n\n2. two\n\n3. three';
    expect(renderMarkdownInline(md)).toBe('<ol><li>one</li><li>two</li><li>three</li></ol>');
  });

  it('keeps a paragraph before and after a list separate from the list', () => {
    const md = 'This is bullets\n\n* 1\n\n* 2\n\nafter';
    expect(renderMarkdownInline(md)).toBe(
      '<p>This is bullets</p>\n<ul><li>1</li><li>2</li></ul>\n<p>after</p>'
    );
  });

  it('breaks the list when the marker type changes', () => {
    const md = '* one\n\n1. two';
    expect(renderMarkdownInline(md)).toBe('<ul><li>one</li></ul>\n<ol><li>two</li></ol>');
  });

  it('escapes raw HTML', () => {
    expect(renderMarkdownInline('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    );
  });

  it('renders safe links only', () => {
    expect(renderMarkdownInline('[clint](https://example.com)')).toContain(
      'href="https://example.com"'
    );
    expect(renderMarkdownInline('[bad](javascript:alert(1))')).toContain('href="#"');
  });
});
