import { TippingStateManager, TipLock, TipRequest } from '../../src/tipping/TippingService';

const req = (id: string, amount = '0.5'): TipRequest => ({
  fromAddress: 'GABC', toAddress: 'GDEF', amount, asset: 'XLM', idempotencyKey: id,
});

describe('TipLock', () => {
  it('acquires fresh lock', () => expect(new TipLock().acquire('k')).toBe(true));
  it('rejects duplicate acquisition', () => { const l = new TipLock(); l.acquire('k'); expect(l.acquire('k')).toBe(false); });
  it('allows re-acquisition after release', () => { const l = new TipLock(); l.acquire('k'); l.release('k'); expect(l.acquire('k')).toBe(true); });
});

describe('TippingStateManager', () => {
  let mgr: TippingStateManager;
  beforeEach(() => { mgr = new TippingStateManager(10); });

  it('deducts balance optimistically', () => { mgr.beginTip(req('t1', '2.0')); expect(mgr.balance).toBe(8); });
  it('returns null for duplicate idempotency key', () => {
    mgr.beginTip(req('t1', '1.0'));
    expect(mgr.beginTip(req('t1', '1.0'))).toBeNull();
    expect(mgr.balance).toBe(9);
  });
  it('returns null when balance insufficient', () => {
    expect(mgr.beginTip(req('t2', '999'))).toBeNull();
    expect(mgr.balance).toBe(10);
  });
  it('rollback restores balance', () => {
    const rb = mgr.beginTip(req('t3', '3.0'))!;
    expect(mgr.balance).toBe(7);
    rb();
    expect(mgr.balance).toBe(10);
  });
  it('commitTip records result', () => {
    mgr.beginTip(req('t4', '1.0'));
    mgr.commitTip('t4', { status: 'success', txHash: 'abc', confirmedAmount: '1.0' });
    expect(mgr.getState().completedTips[0].txHash).toBe('abc');
  });
  it('pendingCount tracks in-flight tips', () => {
    mgr.beginTip(req('t5', '1.0')); mgr.beginTip(req('t6', '1.0'));
    expect(mgr.pendingCount).toBe(2);
    mgr.commitTip('t5', { status: 'success' });
    expect(mgr.pendingCount).toBe(1);
  });
  it('notifies subscribers on state change', () => {
    const received: number[] = [];
    mgr.subscribe(s => received.push(s.balance));
    mgr.beginTip(req('t7', '1.0'));
    expect(received).toContain(9);
  });
  it('rejects zero and negative amounts', () => {
    expect(mgr.beginTip(req('t8', '0'))).toBeNull();
    expect(mgr.beginTip(req('t9', '-1'))).toBeNull();
    expect(mgr.balance).toBe(10);
  });
});
