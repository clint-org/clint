import { Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { stableStringify } from '../util/stable-stringify';

export interface RpcCacheOptions<T> {
  ttl: { fresh: number; stale: number };
  tags: string[];
  fetch: () => Promise<T>;
  swr?: boolean;
}

export interface RpcCacheStats {
  byRpc: Record<string, {
    hits: number;
    misses: number;
    backgroundRefreshes: number;
    invalidations: number;
  }>;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  tags: string[];
  inflight?: Promise<T>;
  signal: WritableSignal<T | undefined>;
  serializedData: string;
}

@Injectable({ providedIn: 'root' })
export class RpcCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private accessOrder = new Map<string, number>();
  private accessCounter = 0;
  private readonly MAX_ENTRIES = 200;
  private channel: BroadcastChannel | null = null;
  private stats: RpcCacheStats | null = null;

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

  enableDevStats(): void {
    this.stats = { byRpc: {} };
  }

  getDevStats(): RpcCacheStats {
    return this.stats ?? { byRpc: {} };
  }

  private recordStat(rpcName: string, kind: 'hits' | 'misses' | 'backgroundRefreshes' | 'invalidations'): void {
    if (!this.stats) return;
    const row = this.stats.byRpc[rpcName] ?? { hits: 0, misses: 0, backgroundRefreshes: 0, invalidations: 0 };
    row[kind] += 1;
    this.stats.byRpc[rpcName] = row;
  }

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    this.touch(key);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry?.inflight) {
      this.recordStat(rpcName, 'hits');
      return entry.inflight;
    }

    if (entry && now < entry.freshUntil) {
      this.recordStat(rpcName, 'hits');
      return entry.data;
    }

    if (entry && now < entry.staleUntil && opts.swr !== false) {
      this.recordStat(rpcName, 'hits');
      this.recordStat(rpcName, 'backgroundRefreshes');
      void this.fetchAndStore(key, opts).catch(() => undefined);
      return entry.data;
    }

    this.recordStat(rpcName, 'misses');
    return this.fetchAndStore(key, opts);
  }

  signal<T>(rpcName: string, params: object): Signal<T | undefined> {
    const key = this.makeKey(rpcName, params);
    let entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      const sig = signal<T | undefined>(undefined) as WritableSignal<T | undefined>;
      entry = {
        data: undefined as unknown as T,
        fetchedAt: 0,
        freshUntil: 0,
        staleUntil: 0,
        tags: [],
        signal: sig as WritableSignal<unknown>,
        serializedData: '',
      } as unknown as CacheEntry<T>;
      this.entries.set(key, entry as CacheEntry<unknown>);
    }
    return entry.signal as Signal<T | undefined>;
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
    const existing = this.entries.get(key) as CacheEntry<T> | undefined;
    const sig: WritableSignal<T | undefined> =
      existing?.signal ?? (signal<T | undefined>(undefined) as WritableSignal<T | undefined>);

    this.entries.set(key, {
      data: existing?.data as T,
      fetchedAt: 0,
      freshUntil: 0,
      staleUntil: 0,
      tags: opts.tags,
      inflight,
      signal: sig as WritableSignal<unknown>,
      serializedData: existing?.serializedData ?? '',
    } as CacheEntry<unknown>);

    try {
      const data = await inflight;
      const now = Date.now();
      const serialized = stableStringify(data as unknown);
      const prev = this.entries.get(key) as CacheEntry<T> | undefined;

      this.entries.set(key, {
        data,
        fetchedAt: now,
        freshUntil: now + opts.ttl.fresh,
        staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
        tags: opts.tags,
        signal: sig as WritableSignal<unknown>,
        serializedData: serialized,
      } as CacheEntry<unknown>);

      if (serialized !== prev?.serializedData) {
        sig.set(data);
      }
      this.evictIfOverCapacity();
      return data;
    } catch (err) {
      this.entries.delete(key);
      this.accessOrder.delete(key);
      throw err;
    }
  }

  private makeKey(rpcName: string, params: object): string {
    return rpcName + ':' + stableStringify(params);
  }

  invalidateTags(tags: string[]): void {
    if (tags.length === 0) return;
    const evictedRpcs = this.invalidateTagsLocal(tags);
    this.channel?.postMessage({ type: 'invalidate', tags });
    if (this.stats) {
      for (const rpc of evictedRpcs) this.recordStat(rpc, 'invalidations');
    }
  }

  private invalidateTagsLocal(tags: string[]): string[] {
    const tagSet = new Set(tags);
    const evictedRpcs: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((t) => tagSet.has(t))) {
        const rpcName = key.split(':')[0];
        evictedRpcs.push(rpcName);
        this.entries.delete(key);
        this.accessOrder.delete(key);
      }
    }
    return evictedRpcs;
  }

  invalidateAll(): void {
    this.entries.clear();
    this.accessOrder.clear();
  }
}
