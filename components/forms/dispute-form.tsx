'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  disputeFormInputSchema,
  toFileDisputeInput,
  hashEvidenceBytes,
  type DisputeFormInput,
} from '@/lib/services/dispute-service';
import { trpc } from '@/lib/trpc-client';
import { Loader2, Shield, Lock } from 'lucide-react';

type FormValues = DisputeFormInput;

export function DisputeForm({
  userId,
  userName,
  onFiled,
}: {
  userId: string;
  userName: string;
  onFiled?: (d: { id: string }) => void;
}) {
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const fileDisputeMut = trpc.disputes.fileDispute.useMutation();
  const addEvidenceMut = trpc.disputes.addEvidence.useMutation();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(disputeFormInputSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'other',
      relatedOrderId: '',
      counterpartyId: '',
      counterpartyName: '',
      escrowDollars: '',
    },
  });

  const category = useWatch({ control, name: 'category', defaultValue: 'other' });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      const input = toFileDisputeInput(values);
      const d = await fileDisputeMut.mutateAsync(input);

      if (evidenceFile) {
        const buf = await evidenceFile.arrayBuffer();
        const sha256 = await hashEvidenceBytes(buf);
        await addEvidenceMut.mutateAsync({
          disputeId: d.id,
          metadata: {
            fileName: evidenceFile.name,
            mimeType: evidenceFile.type || 'application/octet-stream',
            byteSize: evidenceFile.size,
            sha256,
            note: evidenceNote.trim() || undefined,
          },
        });
      }

      utils.disputes.listDisputes.invalidate();
      reset();
      setEvidenceFile(null);
      setEvidenceNote('');
      onFiled?.(d);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not file dispute');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {submitError && (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register('title')} placeholder="Short summary of the issue" />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...register('description')}
          rows={6}
          placeholder="What happened? Include dates, agreed scope, and what you need from mediation."
        />
        {errors.description && (
          <p className="text-xs text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={category}
            onValueChange={(v) =>
              setValue('category', v as FormValues['category'], { shouldValidate: true })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="payment">Payment</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="quality">Quality</SelectItem>
              <SelectItem value="communication">Communication</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          {errors.category && (
            <p className="text-xs text-destructive">{errors.category.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="relatedOrderId">Order / project reference</Label>
          <Input
            id="relatedOrderId"
            {...register('relatedOrderId')}
            placeholder="e.g. bounty id or contract ref"
          />
          {errors.relatedOrderId && (
            <p className="text-xs text-destructive">{errors.relatedOrderId.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="counterpartyId">Counterparty user ID</Label>
          <Input
            id="counterpartyId"
            {...register('counterpartyId')}
            placeholder="Their platform user id"
          />
          {errors.counterpartyId && (
            <p className="text-xs text-destructive">{errors.counterpartyId.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="counterpartyName">Counterparty name (optional)</Label>
          <Input
            id="counterpartyName"
            {...register('counterpartyName')}
            placeholder="Display name"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="escrow">Escrow amount (USD, optional)</Label>
        <Input
          id="escrow"
          type="number"
          min={0}
          step="0.01"
          {...register('escrowDollars')}
          placeholder="0.00 — dual-ledger freeze when &gt; 0"
        />
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Lock className="h-3 w-3" /> Filing freezes both Soroban escrow and Stripe PaymentIntent before either can succeed (payout integrity).
        </p>
        {errors.escrowDollars && (
          <p className="text-xs text-destructive">{errors.escrowDollars.message}</p>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
        <div>
          <Label htmlFor="evidence" className="flex items-center gap-1">
            <Shield className="h-3 w-3" /> Evidence file (optional) — SHA-256 committed on-chain
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            We record a SHA-256 hash on-chain (BytesN&lt;32&gt;) for verification. The contract can verify this commitment.
          </p>
        </div>
        <Input
          id="evidence"
          type="file"
          accept="image/*,.pdf,.zip,.txt"
          onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
        />
        <div className="space-y-2">
          <Label htmlFor="evidenceNote">Evidence note (optional)</Label>
          <Input
            id="evidenceNote"
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.target.value)}
            placeholder="What this file shows"
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || fileDisputeMut.isPending}
        className="w-full sm:w-auto"
      >
        {isSubmitting || fileDisputeMut.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          'File dispute'
        )}
      </Button>
    </form>
  );
}
