import { describe, it, expect } from 'vitest';
import { cleanHtml } from '../../source-extract/html-cleaner';

describe('cleanHtml', () => {
  it('strips script, style, and noscript blocks', () => {
    const html =
      '<p>Hello</p> <script>alert(1)</script> <style>.x{}</style> <noscript>No JS</noscript> <p>World</p>';
    expect(cleanHtml(html).text).toBe('Hello World');
  });

  it('strips HTML tags', () => {
    const html = '<div><span class="bold">text</span></div>';
    expect(cleanHtml(html).text).toBe('text');
  });

  it('decodes common HTML entities', () => {
    const html = '&amp; &lt; &gt; &quot; &#39; &nbsp;';
    expect(cleanHtml(html).text).toBe("& < > \" '");
  });

  it('collapses whitespace', () => {
    const html = '<p>  lots   of    space  </p>';
    expect(cleanHtml(html).text).toBe('lots of space');
  });

  it('detects paywall when body is under 200 chars', () => {
    const html = '<p>Short content</p>';
    const result = cleanHtml(html);
    expect(result.text).toBe('Short content');
    expect(result.paywall_detected).toBe(true);
  });

  it('detects paywall marker in meta tags', () => {
    const longBody = 'x'.repeat(300);
    const html = `<meta name="robots" content="noindex"><p>${longBody}</p>`;
    const result = cleanHtml(html);
    expect(result.paywall_detected).toBe(true);
  });

  it('detects paywall marker via class="paywall"', () => {
    const longBody = 'x'.repeat(300);
    const html = `<div class="paywall"><p>${longBody}</p></div>`;
    const result = cleanHtml(html);
    expect(result.paywall_detected).toBe(true);
  });

  it('does not false-positive on long content without paywall markers', () => {
    const longBody = 'word '.repeat(100);
    const html = `<div class="article"><p>${longBody}</p></div>`;
    const result = cleanHtml(html);
    expect(result.paywall_detected).toBe(false);
  });
});
