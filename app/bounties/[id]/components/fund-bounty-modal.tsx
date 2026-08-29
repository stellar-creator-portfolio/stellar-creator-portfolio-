'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchEscrowQuote, submitEscrowTransaction } from '@/lib/api-client';
import { validateEscrowTransaction, type LockedOracleQuote } from '@/lib/api-models';
import { ApiClientError } from '@/lib/api-client';
import { CheckCircle, Loader2, X, ExternalLink } from 'lucide-react';

interface FundBountyModalProps {
  bountyId: string;
  bountyTitle: string;
  budget: number;
  currency: string;
  onClose: () => void;
}

type FundState = 'idle' | 'submitting' | 'success' | 'error';

export function FundBountyModal({
  bountyId,
  bountyTitle,
  budget,
  currency,
  onClose,
}: FundBountyModalProps) {
  const [walletAddress, setWalletAddress] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  const [quote, setQuote] = useState<LockedOracleQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [state, setState] = useState<FundState>('idle');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  useEffect(() => {
    let active = true;
    setQuoteLoading(true);
    fetchEscrowQuote(bountyId)
      .then((nextQuote) => {
        if (active) {
          setQuote(nextQuote);
          setError('');
        }
      })
      .catch((err) => {
        if (active) {
          setQuote(null);
          setError(err instanceof Error ? err.message : 'Live oracle quote unavailable');
        }
      })
      .finally(() => {
        if (active) setQuoteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bountyId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!quote || quote.expiresAt <= Math.floor(Date.now() / 1000)) {
      setError('The live oracle quote expired. Close and reopen this dialog to refresh it.');
      return;
    }
    if (!walletAddress.trim()) {
      setError('Your Stellar wallet address is required');
      return;
    }
    if (!payeeAddress.trim()) {
      setError('Payee (freelancer) address is required');
      return;
    }

    const txRequest = {
      bountyId,
      operation: 'deposit' as const,
      amount: Number(quote.minXlmOutStroops) / 10_000_000,
      payerAddress: walletAddress.trim(),
      payeeAddress: payeeAddress.trim(),
      tokenAddress: quote.assetContract,
      fiatDenominated: true,
      clientMinXlmOutStroops: quote.minXlmOutStroops,
      quote,
    };

    const validationErrors = validateEscrowTransaction(txRequest);
    if (validationErrors) {
      setError(validationErrors[0].message);
      return;
    }

    setError('');
    setState('submitting');

    try {
      const result = await submitEscrowTransaction(txRequest);
      setTxHash(result.txHash);
      setState('success');
    } catch (err) {
      setState('error');
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-modal-title"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 id="fund-modal-title" className="text-lg font-semibold">
            Fund Bounty
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {state === 'success' ? (
            <div className="text-center space-y-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-lg text-foreground">Funds Locked in Escrow</p>
              <p className="text-sm text-muted-foreground">
                Your deposit for <span className="font-medium text-foreground">{bountyTitle}</span> has been
                confirmed. Funds are now securely held in the Soroban escrow contract.
              </p>
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <Button onClick={onClose} className="w-full mt-2">
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <p className="text-sm text-muted-foreground">
                Deposit funds into escrow for{' '}
                <span className="font-medium text-foreground">{bountyTitle}</span>.
                Funds are held securely until the bounty is completed.
              </p>

              {/* Amount */}
              <div className="space-y-1">
                <label htmlFor="fund-amount" className="text-sm font-medium">
                  Amount ({currency})
                </label>
                <input
                  id="fund-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={budget}
                  readOnly
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {quoteLoading ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading live oracle valuation…
                  </span>
                ) : quote ? (
                  <div className="space-y-1">
                    <p>
                      Minimum deposit:{' '}
                      <strong>{(Number(quote.minXlmOutStroops) / 10_000_000).toFixed(7)} XLM</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Live price ${(Number(quote.priceMicroUsd) / 1_000_000).toFixed(6)} per XLM ·{' '}
                      {quote.sources} sources · expires in at most 60 seconds
                    </p>
                  </div>
                ) : (
                  <span className="text-destructive">Funding is disabled until a live quote is available.</span>
                )}
              </div>

              {/* Payer wallet */}
              <div className="space-y-1">
                <label htmlFor="fund-payer" className="text-sm font-medium">
                  Your Stellar Wallet Address
                </label>
                <input
                  id="fund-payer"
                  type="text"
                  placeholder="G..."
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>

              {/* Payee address */}
              <div className="space-y-1">
                <label htmlFor="fund-payee" className="text-sm font-medium">
                  Freelancer Wallet Address
                </label>
                <input
                  id="fund-payee"
                  type="text"
                  placeholder="G..."
                  value={payeeAddress}
                  onChange={(e) => setPayeeAddress(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>

              {/* Error */}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                  disabled={state === 'submitting'}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={state === 'submitting' || quoteLoading || !quote}
                >
                  {state === 'submitting' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Depositing…
                    </>
                  ) : (
                    'Deposit Funds'
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
