import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "next-themes";
import { LayoutProvider } from "@/components/layout-provider";
import { DataLoaderProvider } from "@/app/providers/DataLoaderProvider";
import { Toaster } from "@/components/ui/toaster";
import { OfflineQueueWatcher } from "@/components/OfflineQueueWatcher";
import "./globals.css";

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#6166f1" },
    { media: "(prefers-color-scheme: dark)", color: "#a78bfa" },
  ],
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  title: "Stellar Creators | Portfolio & Bounty Platform",
  description:
    "Discover world-class creators across UI/UX design, writing, and content creation. Showcase your work, collaborate, and participate in exciting bounties.",
  keywords: [
    "creators",
    "portfolio",
    "bounty",
    "design",
    "writing",
    "content creation",
    "freelance",
    "showcase",
  ],
  generator: "v0.app",
  openGraph: {
    title: "Stellar Creators | Portfolio & Bounty Platform",
    description:
      "Discover and collaborate with world-class creators across multiple disciplines.",
    type: "website",
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth">
      <body className="font-sans antialiased transition-smooth">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          <DataLoaderProvider>
            <LayoutProvider>{children}</LayoutProvider>
          </DataLoaderProvider>
          <OfflineQueueWatcher />
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
