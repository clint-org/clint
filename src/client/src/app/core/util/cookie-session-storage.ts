export interface CookieStorageOptions {
  domain?: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAgeSeconds: number;
}

export function createCookieStorage(options: CookieStorageOptions) {
  return {
    getItem(key: string): string | null {
      const match = document.cookie.match(
        new RegExp('(?:^|;\\s*)' + escapeRe(key) + '=([^;]*)')
      );
      return match ? decodeURIComponent(match[1]) : null;
    },
    setItem(key: string, value: string): void {
      const parts: string[] = [
        `${key}=${encodeURIComponent(value)}`,
        `Max-Age=${options.maxAgeSeconds}`,
        `Path=${options.path}`,
        `SameSite=${capitalize(options.sameSite)}`,
      ];
      if (options.domain) parts.push(`Domain=${options.domain}`);
      if (options.secure) parts.push('Secure');
      document.cookie = parts.join('; ');
    },
    removeItem(key: string): void {
      const parts: string[] = [`${key}=`, 'Max-Age=0', `Path=${options.path}`];
      if (options.domain) parts.push(`Domain=${options.domain}`);
      document.cookie = parts.join('; ');
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
