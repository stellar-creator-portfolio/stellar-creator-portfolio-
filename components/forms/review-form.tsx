'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/widgets/rating-display';
import { cn } from '@/lib/utils';
import {
  generateReviewProof,
  verifyProofLocally,
  type ProofStatus,
  type ZkProofResult,
} from '@/lib/zk-review-proof';

interface ReviewFormProps {
  creatorId: string;
  creatorName: string;
  /** Private credential proving the reviewer completed a bounty with this creator. */
  credential?: string;
  onSubmit: (data: {
    rating: number;
    title: string;
    body: string;
    zkProof: ZkProofResult;
  }) => Promise<void>;
  onCancel?: () => void;
  className?: string;
}

const PROOF_STATUS_LABEL: Record<ProofStatus, string> = {
  idle: '',
  loading_wasm: 'Loading ZK circuit…',
  proving: 'Generating anonymous proof…',
  verified: 'Proof verified ✓',
  failed: 'Proof generation failed',
};

export function ReviewForm({
  creatorId,
  creatorName,
  credential = '',
  onSubmit,
  onCancel,
  className,
}: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [proofStatus, setProofStatus] = useState<ProofStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const isValid = rating > 0 && title.trim().length > 0 && body.trim().length >= 10;
  const isProving = proofStatus === 'loading_wasm' || proofStatus === 'proving';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setError(null);
    setProofStatus('idle');

    let zkProof: ZkProofResult;
    try {
      // Step 1: generate ZK proof before touching the network.
      zkProof = await generateReviewProof(
        { credential, subjectId: creatorId, rating },
        setProofStatus,
      );

      // Step 2: verify locally before submission.
      const isValidProof = await verifyProofLocally(zkProof);
      if (!isValidProof) {
        setProofStatus('failed');
        setError('Cryptographic verification failed. Please try again.');
        return;
      }

      // Step 3: verify with server (uniqueness check)
      const verifyRes = await fetch('/api/reviews/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zkProof),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        setProofStatus('failed');
        setError(data.error || 'Server rejected the proof or nullifier already used.');
        return;
      }
    } catch (err) {
      setProofStatus('failed');
      setError(err instanceof Error ? err.message : 'Proof generation failed.');
      setSubmitting(false);
      return;
    }

    // Step 3: submit with proof attached.
    try {
      await onSubmit({ rating, title: title.trim(), body: body.trim(), zkProof });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('bg-card border border-border rounded-lg p-6 space-y-5', className)}
      aria-label={`Write an anonymous review for ${creatorName}`}
    >
      <div>
        <h3 className="text-lg font-semibold text-foreground">Write an Anonymous Review</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Your identity is protected by a zero-knowledge proof. Your wallet address is never revealed.
        </p>
      </div>

      {/* Star rating picker */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Your Rating <span className="text-destructive">*</span>
        </label>
        <StarRating value={rating} interactive onChange={setRating} size="lg" />
        {rating > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <label htmlFor="review-title" className="block text-sm font-medium text-foreground mb-1.5">
          Review Title <span className="text-destructive">*</span>
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Summarize your experience"
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
          required
        />
      </div>

      {/* Body */}
      <div>
        <label htmlFor="review-body" className="block text-sm font-medium text-foreground mb-1.5">
          Your Review <span className="text-destructive">*</span>
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Share details about your experience working with this creator..."
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground resize-none"
          required
        />
        <p className="text-xs text-muted-foreground mt-1 text-right">{body.length}/2000</p>
      </div>

      {/* ZK proof status indicator */}
      {proofStatus !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-2 text-sm rounded-md px-3 py-2',
            proofStatus === 'verified' && 'bg-green-500/10 text-green-600 dark:text-green-400',
            proofStatus === 'failed' && 'bg-destructive/10 text-destructive',
            isProving && 'bg-muted text-muted-foreground',
          )}
        >
          {isProving && (
            <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          )}
          {PROOF_STATUS_LABEL[proofStatus]}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!isValid || submitting || isProving}>
          {isProving ? 'Proving…' : submitting ? 'Submitting…' : 'Submit Anonymous Review'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A ZK proof is generated in your browser before submission. No personal data leaves your device.
      </p>
    </form>
  );
}
