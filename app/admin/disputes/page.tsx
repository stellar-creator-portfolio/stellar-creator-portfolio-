'use client';

import { useReducer, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc-client';
import { DISPUTE_RESOLUTION_TEMPLATES } from '@/lib/services/dispute-service';
import { Gavel, Users, BarChart3, ArrowLeft, Loader2, Shield, Lock, Clock, AlertTriangle } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  filed: 'Filed',
  evidence: 'Evidence',
  mediation: 'Mediation',
  community_vote: 'Community vote',
  resolved: 'Resolved',
  appealed: 'Appeal',
  closed: 'Closed',
};

export default function AdminDisputesPage() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediationNote, setMediationNote] = useState('');
  const [resolutionExtra, setResolutionExtra] = useState('');
  const [templateId, setTemplateId] = useState(DISPUTE_RESOLUTION_TEMPLATES[0]?.id ?? '');
  const [splitClient, setSplitClient] = useState('');
  const [splitCreator, setSplitCreator] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: listData, isLoading: listLoading } = trpc.disputes.listDisputes.useQuery({});
  const { data: analytics, isLoading: analyticsLoading } = trpc.disputes.computeAnalytics.useQuery();

  const disputes: any[] = listData?.disputes ?? [];
  const selected: any = disputes.find((d: any) => d.id === selectedId) ?? disputes[0] ?? null;

  const voteTally = selected
    ? selected.communityVotes.reduce(
        (acc: any, v: any) => {
          acc[v.side as 'client' | 'creator'] += 1;
          return acc;
        },
        { client: 0, creator: 0 }
      )
    : { client: 0, creator: 0 };

  const utils = trpc.useUtils();

  function refresh() {
    utils.disputes.listDisputes.invalidate();
    utils.disputes.computeAnalytics.invalidate();
    bump();
  }

  const startMediationMut = trpc.disputes.startMediation.useMutation({
    onSuccess: () => refresh(),
  });
  const openVoteMut = trpc.disputes.openCommunityVote.useMutation({
    onSuccess: () => refresh(),
  });
  const resolveMut = trpc.disputes.resolveDispute.useMutation({
    onSuccess: () => refresh(),
    onError: (err: any) => setActionError(err.message),
  });
  const closeMut = trpc.disputes.closeDispute.useMutation({
    onSuccess: () => refresh(),
  });
  const finalizeMut = (trpc.disputes as any).finalizeDispute
    ? (trpc.disputes as any).finalizeDispute.useMutation({ onSuccess: () => refresh(), onError: (err: any) => setActionError(err.message) })
    : null;

  const getEscrowAmount = (d: any) => d?.escrowAmountCents ?? d?.escrow?.amountCents ?? 0;
  const getEscrowId = (d: any) => d?.escrowId ?? d?.relatedOrderId ?? '';
  const isHeld = (d: any) => {
    if (typeof d?.escrow?.held === 'boolean') return d.escrow.held;
    return d?.status !== 'closed' && d?.status !== 'resolved' && getEscrowAmount(d) > 0;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Gavel className="h-7 w-7" /> Dispute mediation
        </h1>
        <p className="text-muted-foreground text-sm">
          Review cases, run mediation, optionally open advisory community votes, and resolve using
          templates. <span className="font-medium text-amber-600">Payout integrity:</span> filing freezes both Soroban and Stripe; resolution settles both ledgers atomically with on-chain appeal window (timelock).
        </p>
      </div>

      {analyticsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Open
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(analytics as any)?.totalOpen ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Mediation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(analytics as any)?.inMediation ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" /> Community vote
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(analytics as any)?.awaitingCommunity ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Resolved (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(analytics as any)?.resolvedLast30d ?? 0}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Cases</CardTitle>
            <CardDescription>Select a dispute</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[480px] overflow-y-auto">
            {listLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : disputes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No disputes found.</p>
            ) : (
              disputes.map((d: any) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                    selected?.id === d.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-secondary/50'
                  }`}
                >
                  <div className="font-medium line-clamp-1">{d.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                    <span className="truncate">{d.id}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Case detail</CardTitle>
            <CardDescription>
              {selected
                ? `${selected.filedByUserId} vs ${selected.counterpartyId ?? selected.creatorId}`
                : 'No disputes loaded'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Nothing to show.</p>
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Order ref:</span>{' '}
                    {getEscrowId(selected)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Category:</span> {selected.category}
                  </p>
                  <p className="pt-2">{selected.description}</p>
                  {isHeld(selected) ? (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-2 mt-2 space-y-1">
                      <p className="text-amber-800 text-sm flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Escrow hold: ${(getEscrowAmount(selected) / 100).toFixed(2)} (dual-ledger freeze)
                      </p>
                      {(selected.onChainTxHash || selected.escrow?.freezeTxHash) && (
                        <p className="text-xs text-muted-foreground">On-chain freeze: {(selected.onChainTxHash || selected.escrow?.freezeTxHash).slice(0, 24)}… (sequence-safe)</p>
                      )}
                      {(selected.evidenceHash || selected.escrow?.evidenceHash) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Shield className="h-3 w-3" /> Evidence commitment: {(selected.evidenceHash || selected.escrow?.evidenceHash).slice(0, 16)}…
                        </p>
                      )}
                      {(selected.appealDeadline || selected.escrow?.appealDeadline || selected.resolution?.appealDeadline) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Appeal deadline (on-chain): {new Date(selected.appealDeadline || selected.escrow?.appealDeadline || selected.resolution?.appealDeadline).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    getEscrowAmount(selected) > 0 && (
                      <p className="text-xs text-muted-foreground">Escrow amount: ${(getEscrowAmount(selected) / 100).toFixed(2)} (not yet frozen - no dispute)</p>
                    )
                  )}
                  {(selected.resolution?.appealDeadline || selected.appealDeadline) && selected.status === 'resolved' && (
                    <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Appeal window active until {new Date(selected.resolution?.appealDeadline || selected.appealDeadline).toLocaleString()} (on-chain timelock)
                    </p>
                  )}
                  {selected.resolution && (
                    <p className="text-xs mt-1">
                      <span className="text-muted-foreground">Resolution:</span> {selected.resolution.outcome} via {selected.resolution.templateId}
                      {selected.resolution.clientCents != null && ` — split $${(selected.resolution.clientCents / 100).toFixed(2)} / $${(selected.resolution.creatorCents / 100).toFixed(2)}`}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Community votes (advisory)
                  </p>
                  <p className="text-sm">
                    Client: {voteTally.client} · Creator: {voteTally.creator}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="med-note">Mediation note</Label>
                  <Textarea
                    id="med-note"
                    value={mediationNote}
                    onChange={(e) => setMediationNote(e.target.value)}
                    rows={2}
                    placeholder="Optional note appended to the case"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={startMediationMut.isPending}
                    onClick={() => {
                      startMediationMut.mutate({
                        disputeId: selected.id,
                        note: mediationNote.trim() || undefined,
                      });
                      setMediationNote('');
                    }}
                  >
                    {startMediationMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : null}
                    Start / continue mediation
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={openVoteMut.isPending}
                  onClick={() => {
                    openVoteMut.mutate({ disputeId: selected.id });
                  }}
                >
                  {openVoteMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  Open community vote window
                </Button>

                <div className="space-y-2 border-t border-border pt-4">
                  <Label>Resolution template (ADMIN only — on-chain + Stripe saga)</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Template" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISPUTE_RESOLUTION_TEMPLATES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templateId === 'tpl_split' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label>Client cents (split)</Label>
                        <input
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          placeholder={`e.g. ${Math.floor(getEscrowAmount(selected) / 2)}`}
                          value={splitClient}
                          onChange={(e) => setSplitClient(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Creator cents (split)</Label>
                        <input
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          placeholder={`e.g. ${Math.ceil(getEscrowAmount(selected) / 2)}`}
                          value={splitCreator}
                          onChange={(e) => setSplitCreator(e.target.value)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground col-span-2">Must sum to ${(getEscrowAmount(selected) / 100).toFixed(2)} — enforced both on-chain and Stripe.</p>
                    </div>
                  )}
                  <Textarea
                    value={resolutionExtra}
                    onChange={(e) => setResolutionExtra(e.target.value)}
                    rows={2}
                    placeholder="Optional extra context for the parties"
                  />
                  {actionError && (
                    <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertTriangle className="h-3 w-3" /> {actionError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={resolveMut.isPending}
                      onClick={() => {
                        setActionError(null);
                        const tpl = DISPUTE_RESOLUTION_TEMPLATES.find((t) => t.id === templateId);
                        let split: any = undefined;
                        if (tpl?.outcome === 'split') {
                          const c = parseInt(splitClient, 10);
                          const cr = parseInt(splitCreator, 10);
                          if (Number.isFinite(c) && Number.isFinite(cr)) {
                            split = { clientCents: c, creatorCents: cr };
                          }
                        }
                        resolveMut.mutate({
                          disputeId: selected.id,
                          templateId,
                          extraSummary: resolutionExtra.trim() || undefined,
                          ...(split ? { split } : {}),
                        } as any);
                        setResolutionExtra('');
                        setSplitClient('');
                        setSplitCreator('');
                      }}
                    >
                      {resolveMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Apply template & resolve (dual-ledger)
                    </Button>
                    {selected.status === 'resolved' && finalizeMut && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={finalizeMut.isPending}
                        onClick={() => {
                          setActionError(null);
                          finalizeMut.mutate({ disputeId: selected.id });
                        }}
                      >
                        {finalizeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Finalize after appeal window
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={closeMut.isPending}
                      onClick={() => {
                        closeMut.mutate({ disputeId: selected.id });
                      }}
                    >
                      {closeMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Close case
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Resolve settles both Soroban + Stripe atomically after appeal window (on-chain timelock). Unauthorized resolve is blocked.</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Timeline</p>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto border rounded-md p-2 bg-muted/30">
                    {(selected.timeline || []).map((t: any) => (
                      <li key={t.id || t.at}>
                        <span className="text-muted-foreground">
                          {new Date(t.at).toLocaleString()}
                        </span>{' '}
                        — {t.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
