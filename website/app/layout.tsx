import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { DocumentIcon, GithubIcon } from "./icons";
import NavLink from "./active-link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Base URL for resolving relative image/link paths
  metadataBase: new URL("https://arc.tsdk.dev"), // Replace with your actual domain

  title: {
    default:
      "TsdkArc | The Elegant and Fully Type-safe Module Composition Library.",
    template: "%s | TsdkArc", // Useful for sub-pages like "Docs | tsdk"
  },
  description:
    "The ultimate type-safe fullstack development framework. Build robust APIs, Web Workers, and auto-generated frontend hooks with zero boilerplate.",

  // SEO Keywords
  keywords: [
    "typescript",
    "type-safe",
    "composable module",
    "server framework",
    "bun",
    "node",
    "di",
    "dependency injection",
  ],
  authors: [{ name: "tsdk-monorepo", url: "https://github.com/tsdk-monorepo" }],
  creator: "tsdk-monorepo",

  // Open Graph (How it looks on Discord, LinkedIn, Facebook, etc.)
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://arc.tsdk.dev",
    title:
      "TsdkArc | The Elegant and Fully Type-safe Module Composition Library.",
    description:
      "Compose modules like building blocks, nest them, and share them across projects. Clean, simple, scalable.",
    siteName: "TsdkArc",
    images: [
      {
        url: "/og.jpg", // Must be exactly 1200x630 pixels for best results
        width: 1200,
        height: 630,
        alt: "TsdkArc | The Elegant and Fully Type-safe Module Composition Library.",
      },
    ],
  },

  // Twitter Cards (How it looks when tweeted)
  twitter: {
    card: "summary_large_image", // This gives you the big, beautiful image preview
    title:
      "TsdkArc | The Elegant and Fully Type-safe Module Composition Library.",
    description:
      "Compose modules like building blocks, nest them, and share them across projects. Clean, simple, scalable.",
    images: ["/og.jpg"],
    creator: "@tsdk.dev",
  },

  // Search Engine Crawling Instructions
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class">
          <div className="min-h-screen min-h-dvh bg-white text-black font-sans selection:bg-black selection:text-white flex flex-col">
            {/* Minimalist Header */}
            <header
              className="px-6 py-6 md:px-12 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-md z-50"
              data-scroll-top>
              <NavLink
                href="/"
                className="font-bold text-2xl tracking-tighter cursor-pointer flex items-center space-x-1">
                <img
                  src="/logo.jpg"
                  className="size-8 rounded-lg"
                  alt="TsdkArc Logo"
                />
                <span>
                  Tsdk<span className="text-gray-400">Arc</span>
                </span>
              </NavLink>

              <div className="flex items-center gap-5 md:gap-8">
                <NavLink
                  href="/docs"
                  activeClassName="text-black!"
                  className={`flex items-center gap-2 text-sm font-medium transition-all active:scale-95 text-gray-500 hover:text-black`}>
                  <DocumentIcon className="w-5 h-5" />
                  <span className="hidden sm:inline">Documentation</span>
                  <span className="sm:hidden">Docs</span>
                </NavLink>
                <a
                  href="https://github.com/tsdk-monorepo/tsdkarc"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black transition-all active:scale-95">
                  <GithubIcon className="w-5 h-5" />
                  <span className="hidden sm:inline">GitHub</span>
                  <span className="sm:hidden">Code</span>
                </a>
              </div>
            </header>

            <main className="flex-1">{children}</main>

            {/* Footer */}
            <footer className="px-6 py-12 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-6 mt-24">
              <p className="text-gray-400 text-sm">
                © {new Date().getFullYear()} TsdkArc.
              </p>
              <div className="flex gap-6 text-sm font-medium">
                <a
                  href="https://github.com/tsdk-monorepo/tsdkarc/issues"
                  className="text-gray-500 hover:text-black transition-colors">
                  Issues
                </a>
                <a
                  href="https://github.com/tsdk-monorepo/tsdkarc"
                  className="text-gray-500 hover:text-black transition-colors">
                  GitHub
                </a>
                <a
                  href="https://www.npmjs.com/package/tsdkarc"
                  className="text-gray-500 hover:text-black transition-colors">
                  NPM
                </a>
              </div>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
