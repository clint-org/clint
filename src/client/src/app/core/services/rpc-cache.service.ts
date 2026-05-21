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

  async get<T>(rpcName: string, params: object, opts: RpcCacheOptions<T>): Promise<T> {
    const key = this.makeKey(rpcName, params);
    const now = Date.now();
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (entry && now < entry.freshUntil) {
      return entry.data;
    }

    return this.fetchAndStore(key, opts);
  }

  private makeKey(rpcName: string, params: object): string {
    return rpcName + ':' + stableStringify(params);
  }

  private async fetchAndStore<T>(key: string, opts: RpcCacheOptions<T>): Promise<T> {
    const now = Date.now();
    const data = await opts.fetch();
    const entry: CacheEntry<T> = {
      data,
      fetchedAt: now,
      freshUntil: now + opts.ttl.fresh,
      staleUntil: opts.ttl.stale === Infinity ? Infinity : now + opts.ttl.stale,
      tags: opts.tags,
    };
    this.entries.set(key, entry as CacheEntry<unknown>);
    return data;
  }
}
