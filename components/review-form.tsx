'use client';

import { useCallback, useState } from 'react';
import { Star, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { validateReview, type ReviewSubmission, type FieldError } from '@/lib/api-models';
import { submitReview, ApiClientError } from '@/lib/api-client';
import {
  generateReviewProof,
  proofIsWellFormed,
  type ProofStatus,
} from '@/lib/zk-review-proof';

// ── Star picker ───────────────────────────────────────────────────────────────

interface StarPickerProps {
  value: number;
  onChange: (rating: number) => void;
  error?: boolean;
}

function StarPicker({ value, onChange, error }: StarPickerProps) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;

  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label="Star rating"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          className={cn(
            'p-0.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            error && value === 0 && 'text-destructive',
          )}
        >
          <Star
            size={28}
            className={cn(
              'transition-colors',
              star <= active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ── Field error helper ────────────────────────────────────────────────────────

function fieldError(errors: FieldError[], field: string): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

// ── Proof status indicator ────────────────────────────────────────────────────

function ProofStatusBadge({ status }: { status: ProofStatus }) {
  if (status === 'idle') return null;

  const config: Record<ProofStatus, { icon: React.ReactNode; label: string; variant: string }> = {
    idle: { icon: null, label: '', variant: '' },
    loading_wasm: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Loading proving circuit…',
      variant: 'text-muted-foreground',
    },
    proving: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      label: 'Generating zero-knowledge proof…',
      variant: 'text-amber-600',
    },
    verified: {
      icon: <ShieldCheck className="h-4 w-4 text-emerald-500" />,
      label: 'Identity verified (ZK proof ready)',
      variant: 'text-emerald-600',
    },
    failed: {
      icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
      label: 'Proof generation failed',
      variant: 'text-destructive',
    },
  };

  const c = config[status];
  return (
    <div className={cn('flex items-center gap-2 text-xs', c.variant)}>
      {c.icon}
      <span>{c.label}</span>
    </div>
  );
}

// ── ReviewForm ────────────────────────────────────────────────────────────────

export interface ReviewFormProps {
  bountyId: string;
  creatorId: string;
  creatorName: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  variant?: 'modal' | 'inline';
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function ReviewForm({
  bountyId,
  creatorId,
  creatorName,
  onSuccess,
  onCancel,
  variant = 'inline',
}: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [credential, setCredential] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formState, setFormState] = useState<FormState>('idle');
  const [apiError, setApiError] = useState<string | null>(null);
  const [proofStatus, setProofStatus] = useState<ProofStatus>('idle');

  const handleGenerateProof = useCallback(async () => {
    if (!credential.trim() || proofStatus === 'proving' || proofStatus === 'loading_wasm') return;

    try {
      const result = await generateReviewProof(
        { credential: credential.trim(), subjectId: creatorId, rating },
        setProofStatus,
      );

      if (!proofIsWellFormed(result)) {
        setProofStatus('failed');
        setApiError('Generated proof is malformed');
        return;
      }

      return result;
    } catch (err) {
      setProofStatus('failed');
      setApiError(err instanceof Error ? err.message : 'Proof generation failed');
      return null;
    }
  }, [credential, creatorId, rating, proofStatus]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    const data: Partial<ReviewSubmission> = { bountyId, creatorId, rating, title, body, reviewerName };
    const errors = validateReview(data);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors([]);

    const proof = await handleGenerateProof();
    if (!proof) return;

    setFormState('submitting');

    try {
      const verifyRes = await fetch('/api/reviews/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nullifier: proof.nullifier,
          proof: proof.proof,
          publicSignals: proof.publicSignals,
          creatorId,
        }),
      });

      if (!verifyRes.ok) {
        const errBody = await verifyRes.json().catch(() => ({}));
        if (verifyRes.status === 409) {
          throw new Error('This review has already been submitted (duplicate detected)');
        }
        throw new Error(errBody.error || 'Proof verification failed');
      }

      await submitReview(data as ReviewSubmission);
      setFormState('success');
      onSuccess?.();
    } catch (err) {
      setFormState('error');
      setProofStatus('failed');
      setApiError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      );
    }
  }

  if (formState === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-border bg-card p-8 text-center space-y-3"
      >
        <div className="text-4xl">🎉</div>
        <h3 className="text-lg font-semibold text-foreground">Review submitted!</h3>
        <p className="text-sm text-muted-foreground">
          Thanks for sharing your feedback on working with {creatorName}.
        </p>
      </div>
    );
  }

  const ratingError = fieldError(fieldErrors, 'rating');
  const titleError = fieldError(fieldErrors, 'title');
  const bodyError = fieldError(fieldErrors, 'body');
  const nameError = fieldError(fieldErrors, 'reviewerName');

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Submit a review"
      className="rounded-xl border border-border bg-card p-6 sm:p-8 space-y-6"
    >
      <div>
        <h2 className="text-xl font-bold text-foreground">Leave a review</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Share your experience working with {creatorName}.
        </p>
      </div>

      {/* Star rating */}
      <div className="space-y-1.5">
        <Label>
          Rating <span aria-hidden>*</span>
        </Label>
        <StarPicker value={rating} onChange={setRating} error={!!ratingError} />
        {ratingError && (
          <p role="alert" className="text-xs text-destructive">
            {ratingError}
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="review-title">
          Title <span aria-hidden>*</span>
        </Label>
        <Input
          id="review-title"
          placeholder="Summarise your experience"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'review-title-error' : undefined}
          maxLength={120}
        />
        {titleError && (
          <p id="review-title-error" role="alert" className="text-xs text-destructive">
            {titleError}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <Label htmlFor="review-body">
          Feedback <span aria-hidden>*</span>
        </Label>
        <Textarea
          id="review-body"
          placeholder="Describe the quality of work, communication, and overall experience…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={!!bodyError}
          aria-describedby={bodyError ? 'review-body-error' : undefined}
          rows={4}
          maxLength={1000}
        />
        <div className="flex justify-between items-start">
          {bodyError ? (
            <p id="review-body-error" role="alert" className="text-xs text-destructive">
              {bodyError}
            </p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{body.length}/1000</span>
        </div>
      </div>

      {/* Reviewer name */}
      <div className="space-y-1.5">
        <Label htmlFor="reviewer-name">
          Your name <span aria-hidden>*</span>
        </Label>
        <Input
          id="reviewer-name"
          placeholder="e.g. Jane D."
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'reviewer-name-error' : undefined}
          maxLength={80}
        />
        {nameError && (
          <p id="reviewer-name-error" role="alert" className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>

      {/* Credential (used for ZK proof, never sent to server) */}
      <div className="space-y-1.5">
        <Label htmlFor="review-credential">
          Proof credential <span aria-hidden>*</span>
        </Label>
        <Input
          id="review-credential"
          type="password"
          placeholder="Enter your private credential for anonymous verification"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Your credential is used to generate a zero-knowledge proof. It never leaves your browser.
        </p>
      </div>

      {/* ZK proof status */}
      <ProofStatusBadge status={proofStatus} />

      {/* API-level error */}
      {apiError && (
        <p role="alert" className="text-sm text-destructive">
          {apiError}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={formState === 'submitting'}
        aria-busy={formState === 'submitting'}
      >
        {formState === 'submitting' ? 'Submitting…' : 'Submit review'}
      </Button>

      {variant === 'modal' && onCancel && (
        <Button
          type="button"
          variant="outline"
          className="w-full mt-2"
          onClick={onCancel}
          disabled={formState === 'submitting'}
        >
          Cancel
        </Button>
      )}
    </form>
  );
}
