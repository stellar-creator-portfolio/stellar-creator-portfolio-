import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BountiesPageSkeleton } from '@/components/ui/skeleton-group';
import { BountiesStatsSection } from '@/components/streaming/bounties-stats-section';
import { fetchBountiesList } from '@/lib/streaming/chunk-data';
import BountiesWithProvider from './BountiesWithProvider';

async function BountiesListSection() {
  const bounties = await fetchBountiesList();
  return <BountiesWithProvider bounties={bounties} />;
}

export default function BountiesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow">
        <Suspense fallback={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="grid grid-cols-3 gap-4 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-muted rounded-xl" />
              ))}
            </div>
          </div>
        }>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
            <BountiesStatsSection />
          </div>
        </Suspense>

        <Suspense fallback={<BountiesPageSkeleton />}>
          <BountiesListSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
