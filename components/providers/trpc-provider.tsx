'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClient, queryClient } from '@/lib/trpc-client';

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => trpcClient);
  const [qClient] = useState(() => queryClient);

  return (
    <trpc.Provider client={client} queryClient={qClient}>
      <QueryClientProvider client={qClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}