'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';
import type { Bounty } from '@/lib/creators-data';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'] as const;

interface ApplyModalProps {
  bounty: Bounty;
  onClose: () => void;
}

function ApplyModal({ bounty, onClose }: ApplyModalProps) {
  const [walletAddress, setWalletAddress] = useState('');
  const [budget, setBudget] = useState(bounty.budget);
  const [timeline, setTimeline] = useState(14);
  const [proposal, setProposal] = useState('');
  
  // Use tRPC mutation for escrow creation
  const createEscrowMutation = trpc.escrow.create.useMutation({
    onSuccess: (data) => {
      setSuccess({ txHash: data.txHash, escrowId: data.escrowId });
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash: string; escrowId: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!proposal.trim()) { setError('Proposal is required.'); return; }
    if (budget <= 0) { setError('Budget must be positive.'); return; }
    
    createEscrowMutation.mutate({
      bountyId: bounty.id,
      payerAddress: walletAddress,
      payeeAddress: 'PAYEE_ADDRESS_PLACEHOLDER', // Replace with actual payee
      amount: budget,
      token: 'USDC', // Default token
    });
  };

  const submitting = createEscrowMutation.isLoading;

  const inputCls = 'w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Apply to ${bounty.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Apply: {bounty.title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="text-xs bg-muted/50 border border-border rounded-md px-3 py-2 text-muted-foreground">
          🔒 Escrow-protected payment — funds are held securely until delivery is confirmed.
        </div>

        {success ? (
          <div data-testid="apply-success" className="space-y-2 text-sm text-foreground">
            <p className="font-semibold text-green-600">Application submitted!</p>
            <p>Your escrow transaction has been recorded.</p>
            <p className="text-xs text-muted-foreground">Escrow ID: {success.escrowId} · TX: {success.txHash}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="wallet-address" className="block text-sm font-medium text-foreground mb-1">Stellar Wallet Address</label>
              <input id="wallet-address" type="text" value={walletAddress} onChange={e => setWalletAddress(e.target.value)} className={inputCls} placeholder="G..." />
            </div>
            <div>
              <label htmlFor="proposed-budget" className="block text-sm font-medium text-foreground mb-1">Proposed Budget (USD)</label>
              <input id="proposed-budget" type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} min={1} className={inputCls} />
            </div>
            <div>
              <label htmlFor="delivery-timeline" className="block text-sm font-medium text-foreground mb-1">Delivery Timeline (days)</label>
              <input id="delivery-timeline" type="number" value={timeline} onChange={e => setTimeline(Number(e.target.value))} min={1} className={inputCls} />
            </div>
            <div>
              <label htmlFor="proposal-text" className="block text-sm font-medium text-foreground mb-1">Proposal</label>
              <textarea id="proposal-text" value={proposal} onChange={e => setProposal(e.target.value)} rows={4} className={inputCls} placeholder="Describe your approach..." />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function BountiesClient({ bounties }: { bounties: Bounty[] }) {
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [activeBounty, setActiveBounty] = useState<Bounty | null>(null);

  // Use tRPC query for bounties
  const bountiesQuery = trpc.bounties.list.useQuery({
    take: 50,
    status: difficulty ? (difficulty as any) : undefined,
  });

  const categories = Array.from(new Set((bountiesQuery.data?.bounties || bounties).map((b) => b.category)));
  
  const filtered = (bountiesQuery.data?.bounties || bounties).filter((b) => {
    if (difficulty && b.difficulty !== difficulty) return false;
    if (category && b.category !== category) return false;
    return true;
  });

  const resetFilters = () => { setDifficulty(null); setCategory(null); };

  const difficultyColor: Record<string, string> = {
    beginner: 'text-green-600',
    intermediate: 'text-yellow-600',
    advanced: 'text-orange-600',
    expert: 'text-red-600',
  };

  return (
    <>
      {activeBounty && <ApplyModal bounty={activeBounty} onClose={() => setActiveBounty(null)} />}

      {/* Hero */}
      <section className="border-b border-border bg-muted/30 py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-3">Bounty Marketplace</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Discover short-term, high-impact projects. Apply with your proposal and get paid via escrow.
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="border-b border-border py-6 sticky top-16 bg-background/80 backdrop-blur-md z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Difficulty:</span>
            {DIFFICULTIES.map((d) => (
              <Button key={d} size="sm" variant={difficulty === d ? 'default' : 'outline'} onClick={() => setDifficulty(difficulty === d ? null : d)}>
                {d}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category:</span>
            {categories.map((c) => (
              <Button key={c} size="sm" variant={category === c ? 'default' : 'outline'} onClick={() => setCategory(category === c ? null : c)}>
                {c}
              </Button>
            ))}
            {(difficulty || category) && (
              <Button size="sm" variant="ghost" onClick={resetFilters}>Reset Filters</Button>
            )}
          </div>
        </div>
      </section>

      {/* Listing */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground mb-6">
            {filtered.length > 0
              ? `Showing ${filtered.length} bounties`
              : 'No bounties match the selected filters.'}
          </p>

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filtered.map((bounty) => (
                <div key={bounty.id} className="bg-card border border-border rounded-xl p-6 space-y-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h2 className="font-semibold text-foreground">{bounty.title}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{bounty.category}</p>
                    </div>
                    <span className="text-lg font-bold text-foreground shrink-0">
                      ${bounty.budget.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{bounty.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className={`text-xs font-medium capitalize ${difficultyColor[bounty.difficulty] ?? ''}`}>
                      {bounty.difficulty}
                    </span>
                    {bounty.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">{bounty.applicants} applicants</span>
                    <Button size="sm" onClick={() => setActiveBounty(bounty)}>Apply Now</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">No bounties match the selected filters.</p>
              <Button variant="outline" onClick={resetFilters}>Reset Filters</Button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
