'use client';

import dynamic from 'next/dynamic';
import type { Bounty } from '@/lib/creators-data';

// Dynamic import for tRPC provider
const TRPCProvider = dynamic(
  () => import('@/components/providers/trpc-provider').then((m) => m.TRPCProvider),
  { ssr: false },
);

const BountiesClient = dynamic(
  () => import('./BountiesClient'),
  { ssr: false },
);

interface BountiesWithProviderProps {
  bounties: Bounty[];
}

export default function BountiesWithProvider({ bounties }: BountiesWithProviderProps) {
  return (
    <TRPCProvider>
      <BountiesClient bounties={bounties} />
    </TRPCProvider>
  );
}