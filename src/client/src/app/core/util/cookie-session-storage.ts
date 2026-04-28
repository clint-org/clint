export interface CookieStorageOptions {
  domain?: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAgeSeconds: number;
}

// Conservative single-cookie value cap. Browsers reject Set-Cookie headers
// over ~4096 bytes (RFC 6265 requires 4096; most enforce that on the value
// + attributes combined). 3000 raw bytes leaves ~1KB headroom for URL
// encoding growth + cookie attributes (Domain, Max-Age, Path, SameSite,
// Secure ~= 70-150 bytes).
const CHUNK_SIZE = 3000;

// Sanity bound on chunk count when reading. A typical Supabase session is
// 3-5KB; 16 chunks = 48KB which is well above any expected payload.
const MAX_CHUNKS = 16;

const CHUNKED_PREFIX = '__chunked:';

export function createCookieStorage(options: CookieStorageOptions) {
  function readSingle(key: string): string | null {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + escapeRe(key) + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(key: string, value: string): void {
    const parts: string[] = [
      `${key}=${encodeURIComponent(value)}`,
      `Max-Age=${options.maxAgeSeconds}`,
      `Path=${options.path}`,
      `SameSite=${capitalize(options.sameSite)}`,
    ];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    if (options.secure) parts.push('Secure');
    document.cookie = parts.join('; ');
  }

  function deleteCookie(key: string): void {
    const parts: string[] = [`${key}=`, 'Max-Age=0', `Path=${options.path}`];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    document.cookie = parts.join('; ');
  }

  function clearChunks(key: string): void {
    for (let i = 0; i < MAX_CHUNKS; i++) {
      if (readSingle(`${key}.${i}`) === null) break;
      deleteCookie(`${key}.${i}`);
    }
  }

  return {
    getItem(key: string): string | null {
      const head = readSingle(key);
      if (head === null) return null;
      if (!head.startsWith(CHUNKED_PREFIX)) return head;
      const count = parseInt(head.slice(CHUNKED_PREFIX.length), 10);
      if (!Number.isFinite(count) || count <= 0 || count > MAX_CHUNKS) {
        return null;
      }
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = readSingle(`${key}.${i}`);
        if (chunk === null) return null;
        parts.push(chunk);
      }
      return parts.join('');
    },

    setItem(key: string, value: string): void {
      // Always clear stragglers from a previous (possibly larger) session
      clearChunks(key);
      if (value.length <= CHUNK_SIZE) {
        writeCookie(key, value);
        return;
      }
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      if (chunks.length > MAX_CHUNKS) {
        // Refuse to write rather than corrupting storage. Caller will see
        // a missing session on next read.
        return;
      }
      writeCookie(key, `${CHUNKED_PREFIX}${chunks.length}`);
      for (let i = 0; i < chunks.length; i++) {
        writeCookie(`${key}.${i}`, chunks[i]);
      }
    },

    removeItem(key: string): void {
      clearChunks(key);
      deleteCookie(key);
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
