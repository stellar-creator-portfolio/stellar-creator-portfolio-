/**
 * Offline-first normalized GraphQL cache.
 * Every entity stored by canonical key (typename:id).
 * Optimistic layer sits above base store; rolled back atomically on error.
 * Collision resolution: last-write-wins with timestamp arbitration.
 */

export type EntityKey = string;
export type FieldKey  = string;

export interface CacheRecord {
  __typename: string;
  id: string;
  [field: FieldKey]: unknown;
}

export interface NormalizedStore {
  [entityKey: EntityKey]: CacheRecord;
}

export interface OptimisticEntry {
  mutationId: string;
  snapshot: NormalizedStore;
  createdAt: number;
}

export interface CollisionRecord {
  entityKey: EntityKey;
  localTimestamp: number;
  serverTimestamp: number;
  resolution: 'local_wins' | 'server_wins';
}

export function entityKey(typename: string, id: string): EntityKey {
  if (!typename || !id) throw new Error(`entityKey requires both typename and id, got: ${typename}:${id}`);
  return `${typename}:${id}`;
}

export function makeRef(typename: string, id: string): { __ref: EntityKey } {
  return { __ref: entityKey(typename, id) };
}

export function isRef(value: unknown): value is { __ref: EntityKey } {
  return typeof value === 'object' && value !== null && '__ref' in value;
}

export class NormalizedCache {
  private store: NormalizedStore = {};
  private optimisticStack: OptimisticEntry[] = [];
  private collisionLog: CollisionRecord[] = [];

  write(record: CacheRecord): void {
    const key = entityKey(record.__typename, record.id);
    this.store[key] = { ...(this.store[key] ?? {}), ...record };
  }

  writeMany(records: CacheRecord[]): void {
    for (const record of records) this.write(record);
  }

  read(typename: string, id: string): CacheRecord | null {
    return this.store[entityKey(typename, id)] ?? null;
  }

  resolveRef(ref: { __ref: EntityKey }): CacheRecord | null {
    return this.store[ref.__ref] ?? null;
  }

  evict(typename: string, id: string): void {
    delete this.store[entityKey(typename, id)];
  }

  snapshot(): NormalizedStore {
    return JSON.parse(JSON.stringify(this.store));
  }

  get size(): number {
    return Object.keys(this.store).length;
  }

  applyOptimistic(mutationId: string, records: CacheRecord[]): void {
    this.optimisticStack.push({ mutationId, snapshot: this.snapshot(), createdAt: Date.now() });
    this.writeMany(records);
  }

  commitOptimistic(mutationId: string): void {
    this.optimisticStack = this.optimisticStack.filter(e => e.mutationId !== mutationId);
  }

  rollbackOptimistic(mutationId: string): void {
    const idx = this.optimisticStack.findIndex(e => e.mutationId === mutationId);
    if (idx === -1) return;
    this.store = JSON.parse(JSON.stringify(this.optimisticStack[idx].snapshot));
    const laterEntries = this.optimisticStack.splice(idx);
    for (const entry of laterEntries.slice(1)) {
      this.writeMany(Object.values(JSON.parse(JSON.stringify(entry.snapshot))) as CacheRecord[]);
    }
  }

  get pendingOptimisticCount(): number { return this.optimisticStack.length; }

  resolveCollision(local: CacheRecord, server: CacheRecord): CacheRecord {
    const localTs  = (local.__updatedAt  as number | undefined) ?? 0;
    const serverTs = (server.__updatedAt as number | undefined) ?? 1;
    const resolution: CollisionRecord['resolution'] = localTs > serverTs ? 'local_wins' : 'server_wins';
    this.collisionLog.push({ entityKey: entityKey(server.__typename, server.id), localTimestamp: localTs, serverTimestamp: serverTs, resolution });
    return resolution === 'local_wins' ? local : server;
  }

  getCollisionLog(): CollisionRecord[] { return [...this.collisionLog]; }
  clearCollisionLog(): void { this.collisionLog = []; }

  clear(): void {
    this.store = {};
    this.optimisticStack = [];
    this.collisionLog = [];
  }
}
