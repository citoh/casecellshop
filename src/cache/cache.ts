interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const store = new Map<string, CacheEntry<any>>();

export function getCache<T>(key: string): T | undefined {
    const entry = store.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.data as T;
    return undefined;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
    store.set(key, { data, expiresAt: Date.now() + ttlMs });
}
