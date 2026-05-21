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
  private accessOrder = new Map<string, number>();
  private accessCounter = 0;
  private readonly MAX_ENTRIES = 200;
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
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // No-op for now; the next get() call hits the SWR path naturally.
          // Hook placed here for a future "refresh in background without consumer" feature.
        }
      });
    }
  }

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    this.touch(key);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry?.inflight) return entry.inflight;
    if (entry && now < entry.freshUntil) return entry.data;
    if (entry && now < entry.staleUntil && opts.swr !== false) {
      void this.fetchAndStore(key, opts).catch(() => undefined);
      return entry.data;
    }
    return this.fetchAndStore(key, opts);
  }

  private touch(key: string): void {
    this.accessCounter += 1;
    this.accessOrder.set(key, this.accessCounter);
  }

  private evictIfOverCapacity(): void {
    if (this.entries.size <= this.MAX_ENTRIES) return;
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.inflight) continue;
      const access = this.accessOrder.get(key) ?? 0;
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.entries.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
  }

  private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
    const inflight = opts.fetch();
    this.entries.set(key, {
      data: undefined as unknown as T,
      fetchedAt: 0, freshUntil: 0, staleUntil: 0,
      tags: opts.tags, inflight,
    } as CacheEntry<unknown>);

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
      this.evictIfOverCapacity();
      return data;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }

  private makeKey(rpcName: string, params: object): string {
    return rpcName + ':' + stableStringify(params);
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
        this.accessOrder.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.entries.clear();
    this.accessOrder.clear();
  }
}
