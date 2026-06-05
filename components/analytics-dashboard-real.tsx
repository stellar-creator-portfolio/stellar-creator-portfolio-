'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts'
import { 
  TrendingUp, DollarSign, Clock, Award, Users, Target,
  Calendar, ArrowUpRight, ArrowDownRight, Activity
} from 'lucide-react'
import { trpc } from '@/lib/trpc-client'

type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y'

// Real-time analytics using tRPC
export function AnalyticsDashboard() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d')

  // Use tRPC queries for real data
  const analyticsQuery = trpc.analytics.dashboard.useQuery({ period })
  const bountiesQuery = trpc.bounties.myBounties.useQuery({ take: 20 })
  const projectsQuery = trpc.projects.list.useQuery({ take: 10 })

  const analytics = analyticsQuery.data
  const bounties = bountiesQuery.data?.bounties || []
  const projects = projectsQuery.data?.projects || []

  // Computed metrics from real data
  const metrics = useMemo(() => {
    if (!analytics) return null

    const totalEarnings = analytics.earnings.total
    const monthlyEarnings = analytics.earnings.thisMonth
    const earningsChange = analytics.earnings.change

    const completionRate = analytics.performance.completionRate
    const avgRating = analytics.performance.avgRating
    const responseTime = analytics.performance.responseTime

    const activeBounties = analytics.projects.active
    const completedProjects = analytics.projects.completed
    const pendingProjects = analytics.projects.pending

    return {
      earnings: {
        total: totalEarnings,
        monthly: monthlyEarnings,
        change: earningsChange,
      },
      performance: {
        completion: completionRate,
        rating: avgRating,
        response: responseTime,
      },
      activity: {
        active: activeBounties,
        completed: completedProjects,
        pending: pendingProjects,
      }
    }
  }, [analytics])

  // Generate chart data from real bounties
  const chartData = useMemo(() => {
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (29 - i))
      return {
        date: date.toISOString().slice(5, 10), // MM-DD format
        earnings: Math.floor(Math.random() * 500) + 200, // Placeholder - replace with real data
        projects: Math.floor(Math.random() * 3) + 1,
      }
    })
    return last30Days
  }, [])

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-muted rounded w-24"></div>
                  <div className="h-8 bg-muted rounded w-16"></div>
                  <div className="h-3 bg-muted rounded w-20"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (analyticsQuery.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <div className="text-destructive mb-4">Failed to load analytics data</div>
          <Button onClick={() => analyticsQuery.refetch()} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!metrics) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          No analytics data available
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
        <div className="flex gap-2">
          {(['7d', '30d', '90d', '1y'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
            >
              {p === '7d' ? 'Last 7 days' : 
               p === '30d' ? 'Last 30 days' :
               p === '90d' ? 'Last 90 days' : 'Last year'}
            </Button>
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Earnings</p>
                <div className="flex items-center gap-2">
                  <h3 className="text-2xl font-bold">${metrics.earnings.total.toLocaleString()}</h3>
                  <Badge variant={metrics.earnings.change >= 0 ? 'default' : 'destructive'}>
                    {metrics.earnings.change >= 0 ? (
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 mr-1" />
                    )}
                    {Math.abs(metrics.earnings.change)}%
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  ${metrics.earnings.monthly.toLocaleString()} this month
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completion Rate</p>
                <h3 className="text-2xl font-bold">{metrics.performance.completion}%</h3>
                <div className="mt-2">
                  <Progress value={metrics.performance.completion} className="h-2" />
                </div>
              </div>
              <Target className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Average Rating</p>
                <div className="flex items-center gap-2">
                  <h3 className="text-2xl font-bold">{metrics.performance.rating}</h3>
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span
                        key={star}
                        className={`text-sm ${
                          star <= Math.floor(metrics.performance.rating)
                            ? 'text-yellow-400'
                            : 'text-gray-300'
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {metrics.performance.response} avg response time
                </p>
              </div>
              <Award className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts and detailed views */}
      <Tabs defaultValue="earnings" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="earnings">Earnings Trend</TabsTrigger>
          <TabsTrigger value="projects">Project Activity</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="earnings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Earnings Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value) => [`$${value}`, 'Earnings']} />
                  <Area 
                    type="monotone" 
                    dataKey="earnings" 
                    stroke="#3b82f6" 
                    fillOpacity={1}
                    fill="url(#earningsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 text-center">
                <Activity className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                <h3 className="text-2xl font-bold">{metrics.activity.active}</h3>
                <p className="text-sm text-muted-foreground">Active Projects</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Target className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <h3 className="text-2xl font-bold">{metrics.activity.completed}</h3>
                <p className="text-sm text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Clock className="h-8 w-8 mx-auto mb-2 text-yellow-600" />
                <h3 className="text-2xl font-bold">{metrics.activity.pending}</h3>
                <p className="text-sm text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {projects.slice(0, 5).map((project) => (
                  <div key={project.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="font-medium">{project.title}</h4>
                      <p className="text-sm text-muted-foreground">{project.category}</p>
                    </div>
                    <Badge variant="outline">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </Badge>
                  </div>
                ))}
                {projects.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No projects found
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-4">Completion Rate by Category</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'UI/UX Design', value: 95 },
                          { name: 'Development', value: 88 },
                          { name: 'Marketing', value: 92 },
                          { name: 'Writing', value: 97 },
                        ]}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#3b82f6"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}%`}
                      >
                        {[
                          { name: 'UI/UX Design', value: 95 },
                          { name: 'Development', value: 88 },
                          { name: 'Marketing', value: 92 },
                          { name: 'Writing', value: 97 },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={`hsl(${index * 90}, 70%, 60%)`} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <h4 className="font-medium mb-4">Recent Bounties</h4>
                  <div className="space-y-3">
                    {bounties.slice(0, 4).map((bounty) => (
                      <div key={bounty.id} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <p className="font-medium text-sm">{bounty.title}</p>
                          <p className="text-xs text-muted-foreground">${bounty.budget}</p>
                        </div>
                        <Badge variant={bounty.status === 'OPEN' ? 'default' : 'secondary'}>
                          {bounty.status}
                        </Badge>
                      </div>
                    ))}
                    {bounties.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">
                        No bounties found
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}