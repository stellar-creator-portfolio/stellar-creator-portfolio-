import { NormalizedCache, entityKey, makeRef, isRef, CacheRecord } from '../../src/cache/NormalizedCache';

const c1: CacheRecord = { __typename: 'Creator', id: 'c1', name: 'Alice', followerCount: 100 };
const c2: CacheRecord = { __typename: 'Creator', id: 'c2', name: 'Bob',   followerCount: 200 };
const p1: CacheRecord = { __typename: 'Post',    id: 'p1', title: 'Hi',   author: makeRef('Creator', 'c1') };

describe('entityKey', () => {
  it('builds canonical key', () => expect(entityKey('Creator', 'abc')).toBe('Creator:abc'));
  it('throws on missing typename', () => expect(() => entityKey('', 'abc')).toThrow());
  it('throws on missing id', () => expect(() => entityKey('Creator', '')).toThrow());
});

describe('makeRef / isRef', () => {
  it('creates __ref object', () => expect(makeRef('Creator', 'c1')).toEqual({ __ref: 'Creator:c1' }));
  it('isRef identifies ref', () => expect(isRef({ __ref: 'Creator:c1' })).toBe(true));
  it('isRef rejects plain object', () => expect(isRef({ name: 'Alice' })).toBe(false));
});

describe('NormalizedCache — base operations', () => {
  let cache: NormalizedCache;
  beforeEach(() => { cache = new NormalizedCache(); });

  it('writes and reads an entity', () => {
    cache.write(c1);
    expect(cache.read('Creator', 'c1')).toMatchObject({ name: 'Alice' });
  });
  it('merges fields without clobbering', () => {
    cache.write(c1);
    cache.write({ __typename: 'Creator', id: 'c1', followerCount: 999 });
    expect(cache.read('Creator', 'c1')?.name).toBe('Alice');
    expect(cache.read('Creator', 'c1')?.followerCount).toBe(999);
  });
  it('returns null for unknown entity', () => expect(cache.read('Creator', 'nope')).toBeNull());
  it('evicts an entity', () => {
    cache.write(c1);
    cache.evict('Creator', 'c1');
    expect(cache.read('Creator', 'c1')).toBeNull();
  });
  it('resolves __ref to entity', () => {
    cache.write(c1); cache.write(p1);
    expect(cache.resolveRef({ __ref: 'Creator:c1' })?.name).toBe('Alice');
  });
  it('writeMany writes all', () => { cache.writeMany([c1, c2]); expect(cache.size).toBe(2); });
});

describe('NormalizedCache — optimistic layer', () => {
  let cache: NormalizedCache;
  beforeEach(() => { cache = new NormalizedCache(); cache.write(c1); });

  it('applies optimistic write', () => {
    cache.applyOptimistic('m1', [{ ...c1, followerCount: 999 }]);
    expect(cache.read('Creator', 'c1')?.followerCount).toBe(999);
    expect(cache.pendingOptimisticCount).toBe(1);
  });
  it('commit removes from stack and keeps data', () => {
    cache.applyOptimistic('m1', [{ ...c1, followerCount: 999 }]);
    cache.commitOptimistic('m1');
    expect(cache.pendingOptimisticCount).toBe(0);
    expect(cache.read('Creator', 'c1')?.followerCount).toBe(999);
  });
  it('rollback restores pre-mutation state', () => {
    const rb = () => cache.rollbackOptimistic('m1');
    cache.applyOptimistic('m1', [{ ...c1, followerCount: 999 }]);
    rb();
    expect(cache.read('Creator', 'c1')?.followerCount).toBe(100);
    expect(cache.pendingOptimisticCount).toBe(0);
  });
  it('rollback of unknown key is no-op', () => expect(() => cache.rollbackOptimistic('x')).not.toThrow());
});

describe('NormalizedCache — collision resolution', () => {
  let cache: NormalizedCache;
  beforeEach(() => { cache = new NormalizedCache(); });

  it('server wins when no timestamps', () => {
    const result = cache.resolveCollision({ __typename: 'Creator', id: 'c1', name: 'Local' }, { __typename: 'Creator', id: 'c1', name: 'Server' });
    expect(result.name).toBe('Server');
  });
  it('local wins when local timestamp is newer', () => {
    const result = cache.resolveCollision(
      { __typename: 'Creator', id: 'c1', name: 'Local',  __updatedAt: 2000 },
      { __typename: 'Creator', id: 'c1', name: 'Server', __updatedAt: 1000 },
    );
    expect(result.name).toBe('Local');
  });
  it('logs the collision', () => {
    cache.resolveCollision({ __typename: 'Creator', id: 'c1', name: 'A', __updatedAt: 1 }, { __typename: 'Creator', id: 'c1', name: 'B', __updatedAt: 2 });
    expect(cache.getCollisionLog()).toHaveLength(1);
    expect(cache.getCollisionLog()[0].resolution).toBe('server_wins');
  });
});
