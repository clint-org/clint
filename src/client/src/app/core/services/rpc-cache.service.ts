import { Injectable } from '@angular/core';
import { stableStringify } from '../util/stable-stringify';

export interface RpcCacheOptions<T> {
  ttl: { fresh: number; stale: number };
  tags: string[];
  fetch: () => Promise<T>;
  swr?: boolean;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  tags: string[];
  inflight?: Promise<T>;
}

@Injectable({ providedIn: 'root' })
export class RpcCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('rpc-cache');
      this.channel.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type === 'invalidate' && Array.isArray(e.data.tags)) {
          this.invalidateTagsLocal(e.data.tags as string[]);
        }
      });
    }
  }

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry?.inflight) {
      return entry.inflight;
    }

    if (entry && now < entry.freshUntil) {
      return entry.data;
    }

    if (entry && now < entry.staleUntil && opts.swr !== false) {
      void this.fetchAndStore(key, opts).catch(() => {
        // background refresh failure is silent
      });
      return entry.data;
    }

    return this.fetchAndStore(key, opts);
  }

  invalidateTags(tags: string[]): void {
    if (tags.length === 0) return;
    this.invalidateTagsLocal(tags);
    this.channel?.postMessage({ type: 'invalidate', tags });
  }

  private invalidateTagsLocal(tags: string[]): void {
    const tagSet = new Set(tags);
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((t) => tagSet.has(t))) {
        this.entries.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  private makeKey(rpcName: string, params: object): string {
    return rpcName + ':' + stableStringify(params);
  }

  private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
    const inflight = opts.fetch();
    const placeholder: CacheEntry<T> = {
      data: undefined as unknown as T,
      fetchedAt: 0,
      freshUntil: 0,
      staleUntil: 0,
      tags: opts.tags,
      inflight,
    };
    this.entries.set(key, placeholder as CacheEntry<unknown>);

    try {
      const data = await inflight;
      const now = Date.now();
      this.entries.set(key, {
        data,
        fetchedAt: now,
        freshUntil: now + opts.ttl.fresh,
        staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
        tags: opts.tags,
      } as CacheEntry<unknown>);
      return data;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }
}
