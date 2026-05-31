import dynamic from 'next/dynamic'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'

// Dynamic import keeps Yjs/Worker APIs out of the SSR bundle
const AnalyticsDashboard = dynamic(
  () => import('@/components/analytics-dashboard').then((m) => m.AnalyticsDashboard),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-md bg-muted" /> },
)

export default function ProfileAnalyticsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow container max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Earnings, performance, and predictive insights — computed off the main thread.
          </p>
        </div>
        <AnalyticsDashboard />
      </main>
      <Footer />
    </div>
  )
}
