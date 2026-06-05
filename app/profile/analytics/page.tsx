'use client'

import dynamic from 'next/dynamic'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'

// Dynamic import keeps Yjs/Worker APIs out of the SSR bundle
const AnalyticsDashboardReal = dynamic(
  () => import('@/components/analytics-dashboard-real').then((m) => m.AnalyticsDashboard),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-md bg-muted" /> },
)

// Dynamic import for tRPC provider
const TRPCProvider = dynamic(
  () => import('@/components/providers/trpc-provider').then((m) => m.TRPCProvider),
  { ssr: false },
)

export default function ProfileAnalyticsPage() {
  return (
    <TRPCProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-grow container max-w-5xl mx-auto px-4 py-10">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Real-time earnings, performance, and insights from connected data sources.
            </p>
          </div>
          <AnalyticsDashboardReal />
        </main>
        <Footer />
      </div>
    </TRPCProvider>
  )
}
