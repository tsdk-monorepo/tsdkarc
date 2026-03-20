"use client";
/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect, useRef } from "react";
import ShikiCode from "./code";
import { littkk } from "littkk";
import Link from "next/link";
import {
  TerminalIcon,
  PlayIcon,
  VolumeOffIcon,
  VolumeUpIcon,
  CheckIcon,
  CopyIcon,
  ShieldIcon,
  NetworkIcon,
  PuzzleIcon,
  CycleIcon,
  XIcon,
} from "./icons";
const videoSrc = "/output.m3u8";

// --- Home View Component ---
export default function HomeView({
  snippets,
}: {
  snippets: { quickstart: string; quickstartHTML: string };
}) {
  const [isMuted, setIsMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFeatureVisible, setIsFeatureVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const featureRef = useRef(null);

  useEffect(() => {
    const ctrl = littkk();
    return () => ctrl.destroy();
  }, []);

  // Intersection Observer for Flowing Light
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsFeatureVisible(true);
        } else {
          setIsFeatureVisible(false); // Reset so it triggers immediately when scrolling back
        }
      },
      { threshold: 0.3 }
    );

    if (featureRef.current) observer.observe(featureRef.current);
    return () => observer.disconnect();
  }, []);

  // HLS (.m3u8) Video Initialization
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Use an example m3u8 stream

    if (
      video &&
      video.canPlayType &&
      video.canPlayType("application/vnd.apple.mpegurl")
    ) {
      // Native support (Safari / Mobile)
      video.src = videoSrc;
    } else {
      import("hls.js").then((Hls) => {
        const hls = new Hls.default();
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.default.Events.MANIFEST_PARSED, () => {
          if (isPlaying) {
            video
              .play()
              .catch((e) => console.error("HLS auto-play failed:", e));
          }
        });
      });
    }
  }, []); // Only run once on mount

  const handleCopy = () => {
    navigator.clipboard.writeText("npm install tsdkarc");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [code, setCode] = useState(snippets.quickstart);
  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setIsCodeCopied(true);
    setTimeout(() => setIsCodeCopied(false), 2000);
  };

  const toggleMute = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  };

  const togglePlay = () => {
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    if (isMuted) {
      const nextMuted = false;
      setIsMuted(nextMuted);
      if (videoRef.current) {
        videoRef.current.muted = nextMuted;
      }
    }

    if (videoRef.current) {
      if (nextPlaying) {
        videoRef.current!.play().catch((e) => console.error("Play failed:", e));
      } else {
        videoRef.current!.pause();
      }
    }
  };

  const useCases = [
    {
      title: "Bun / Node.js Custom Frameworks",
      icon: "🚀",
      desc: "Wire up config, databases, caches, HTTP servers and Business modules in the exact right order without brittle, manual setup.",
    },
    {
      title: "Shared Library Modules",
      icon: "📦",
      desc: "Publish reusable infrastructure (like logging or auth or others business modules) that other projects can drop in effortlessly.",
    },
    {
      title: "Background Workers",
      icon: "⚙️",
      desc: "Safely orchestrate queue consumers and cron jobs, ensuring automatic resource cleanup via shutdown hooks.",
    },
    {
      title: "Isolated Testing",
      icon: "🧪",
      desc: "Swap out a real database module for an in-memory mock simply by replacing a single dependency.",
    },
  ];

  const notCases = [
    {
      title: "A Web Framework",
      desc: "No routing, no HTTP handling, no middleware pipeline (though you can register those as context values).",
    },
    {
      title: "A Runtime DI Container",
      desc: "No decorators, no reflection. Dependencies are declared statically at definition time.",
    },
    {
      title: "A State Management Library",
      desc: "The context is boot-time wiring, not reactive application state (not Redux, Zustand, etc.).",
    },
    {
      title: "A Task Runner / Build Tool",
      desc: "Not a replacement for task runners or build tools like Grunt, Gulp, or Make.",
    },
    {
      title: "A Process Manager",
      desc: "Not a replacement for process managers like PM2, Docker, or systemd.",
    },
    {
      title: "An ORM or Data Layer",
      desc: "It can hold a DB pool, but it knows absolutely nothing about databases itself.",
    },
    {
      title: "A Config Loader",
      desc: "You bring your own config reading logic; it just helps you share it safely across modules.",
    },
  ];

  return (
    <div className="animate-in fade-in duration-500">
      {/* Hero Section */}
      <section className="py-16 md:py-32 max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 items-center">
        {/* Left: Content */}
        <div className="w-full lg:w-1/2 space-y-10 px-6 md:px-12">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-tight">
            Type-safe module composable.
          </h1>
          <p className="text-lg md:text-xl text-gray-500 max-w-md leading-relaxed">
            Compose modules like building blocks, nest them, and share them
            across projects. Clean, simple, type safe and scalable.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleCopy}
              className="group flex items-center justify-center gap-3 bg-black text-white px-8 py-4 rounded-lg font-medium hover:bg-gray-800 active:scale-95 transition-all w-full sm:w-auto">
              <TerminalIcon className="size-5 text-gray-400 group-hover:text-white transition-colors" />
              {copied ? "Copied to clipboard" : "npm install tsdkarc"}
            </button>

            <Link
              href="/docs"
              className="flex items-center justify-center gap-3 bg-white text-black border border-gray-200 px-8 py-4 rounded-lg font-medium hover:border-black active:scale-95 transition-all w-full sm:w-auto">
              Read Documentation
            </Link>
          </div>
        </div>

        {/* Right: M3U8 Video Presentation */}
        <div className="w-full lg:w-1/2 relative bg-gray-50 md:rounded-2xl overflow-hidden group">
          {/* 透明遮罩层：用于拦截点击事件控制播放/暂停 */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            onClick={togglePlay}
          />

          <video
            ref={videoRef}
            className="w-full h-full aspect-video object-cover opacity-95 transition-opacity duration-700 pointer-events-none"
            autoPlay={isPlaying}
            poster="/video.jpg"
            loop
            muted={isMuted}
            playsInline={true}
            disablePictureInPicture={true}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm pointer-events-none z-20">
              <div className="bg-white text-black rounded-full p-4 transform transition-transform scale-110 shadow-xl">
                <PlayIcon className="w-8 h-8 ml-1" />
              </div>
            </div>
          )}

          <button
            onClick={toggleMute}
            className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-md text-black p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white active:scale-90 z-30"
            aria-label={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? (
              <VolumeOffIcon className="size-5" />
            ) : (
              <VolumeUpIcon className="size-5" />
            )}
          </button>
        </div>
      </section>

      {/* Minimal Quick Start with Copy Button */}
      <section className="md:px-12 max-w-7xl mx-auto mb-32 relative group">
        <h2 className="px-6 md:px-0 text-sm font-bold tracking-widest uppercase text-gray-400 mb-6">
          Quick Start
        </h2>
        <div className="bg-[#282A36] md:rounded-2xl p-6 md:p-8 overflow-x-auto relative">
          {/* Enhanced Copy Button */}
          <button
            onClick={handleCopyCode}
            className="absolute top-4 right-4 bg-white border border-gray-200 text-gray-500 hover:text-black hover:border-black p-2 rounded-lg transition-all active:scale-90 opacity-0 group-hover:opacity-100 flex items-center gap-2 text-xs font-medium"
            aria-label="Copy code">
            {isCodeCopied ? (
              <CheckIcon className="w-4 h-4 text-green-600" />
            ) : (
              <CopyIcon className="w-4 h-4" />
            )}
            {isCodeCopied ? "Copied!" : "Copy"}
          </button>

          <ShikiCode
            className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
            codeHtml={snippets.quickstartHTML}
          />
        </div>
      </section>

      {/* Features - Typography & Spacing Bento with Restored Shimmer */}
      <section className="py-16 md:px-16 max-w-7xl mx-auto">
        <h2 className="px-6 md:px-0 text-3xl font-bold tracking-tight mb-12">
          Why TsdkArc?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Feature 1: Type Safety (With Elegant Flowing Light) */}
          <div
            ref={featureRef}
            className="md:col-span-2 p-[2px] md:rounded-2xl bg-gradient-to-r from-gray-900 via-white to-gray-900 animate-border-flow group transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] cursor-crosshair hover:shadow-2xl hover:shadow-gray-300/30">
            <div className="bg-black text-white p-8 md:p-12 md:rounded-[14px] h-full flex flex-col justify-between relative overflow-hidden">
              {/* Internal Shimmer Sweep (Scroll & Periodic) */}
              {isFeatureVisible && (
                <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none animate-periodic-shimmer"></div>
              )}

              <ShieldIcon className="w-10 h-10 mb-8 text-gray-400 group-hover:text-white transition-colors relative z-10" />
              <div className="relative z-10">
                <h3 className="text-2xl md:text-3xl font-bold mb-4 tracking-tight">
                  Fully Type-Safe Context
                </h3>
                <p className="text-gray-400 text-lg leading-relaxed max-w-md">
                  The merged union of all slices is fully typed at each module's
                  boundary. Autocomplete works exactly as you'd expect,
                  everywhere.
                </p>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="bg-gray-50 border border-gray-100 p-8 md:p-10 md:rounded-2xl flex flex-col justify-between group transition-transform duration-300 hover:scale-[1.02] active:scale-[0.96] cursor-crosshair hover:border-gray-300">
            <NetworkIcon className="w-10 h-10 mb-8 text-gray-400 group-hover:text-black transition-colors" />
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">
                Auto Resolution
              </h3>
              <p className="text-gray-500 leading-relaxed">
                Declare your dependencies.{" "}
                <code className="bg-gray-200 text-black px-1 rounded text-sm">
                  start()
                </code>{" "}
                resolves the graph.
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="bg-gray-50 border border-gray-100 p-8 md:p-10 md:rounded-2xl flex flex-col justify-between group transition-transform duration-300 hover:scale-[1.02] active:scale-[0.96] cursor-crosshair hover:border-gray-300">
            <PuzzleIcon className="w-10 h-10 mb-8 text-gray-400 group-hover:text-black transition-colors" />
            <div>
              <h3 className="text-xl font-bold mb-3 tracking-tight">
                Composable
              </h3>
              <p className="text-gray-500 leading-relaxed">
                Build small modules. Complex wiring becomes just a simple chain.
              </p>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="md:col-span-2 border-2 border-black p-8 md:p-12 md:rounded-2xl flex flex-col justify-between group transition-transform duration-300 hover:scale-[1.01] active:scale-[0.98] cursor-crosshair">
            <CycleIcon className="w-10 h-10 mb-8 text-gray-400 group-hover:text-black transition-colors" />
            <div>
              <h3 className="text-2xl md:text-3xl font-bold mb-4 tracking-tight">
                Robust Lifecycle
              </h3>
              <p className="text-gray-600 text-lg leading-relaxed max-w-md">
                Granular control over setup and teardown. From{" "}
                <code className="font-mono text-sm bg-gray-100 px-1 rounded">
                  beforeBoot
                </code>{" "}
                to{" "}
                <code className="font-mono text-sm bg-gray-100 px-1 rounded">
                  afterShutdown
                </code>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Minimalist Lists (Use Cases & What it is NOT) */}
      <section className="py-16 md:px-12 max-w-7xl mx-auto flex flex-col md:flex-row gap-20">
        {/* Ideal Use Cases */}
        <div className="flex-1">
          <h2 className="px-6 md:px-0 text-2xl font-bold tracking-tight mb-8">
            Ideal Use Cases
          </h2>
          <div className="space-y-2 px-3 md:px-0">
            {useCases.map((uc, i) => (
              <div
                key={i}
                className="flex gap-4 p-4 -ml-4 rounded-xl hover:bg-gray-50 transition-colors group cursor-crosshair active:scale-[0.98]">
                <div className="text-2xl shrink-0 transition-transform duration-300 group-hover:scale-110">
                  {uc.icon}
                </div>
                <div>
                  <h3 className="font-bold text-lg">{uc.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    {uc.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What it is NOT */}
        <div className="flex-1">
          <h2 className="px-6 md:px-0 text-2xl font-bold tracking-tight mb-8 text-gray-400">
            What it is NOT
          </h2>
          <div className="space-y-2 px-3 md:px-0">
            {notCases.map((nc, i) => (
              <div
                key={i}
                className="flex gap-4 p-4 -ml-4 rounded-xl hover:bg-gray-50 transition-colors group cursor-crosshair active:scale-[0.98]">
                <div className="text-gray-300 shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:text-red-500">
                  <XIcon className="w-6 h-6 mt-1" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-700 group-hover:text-black transition-colors">
                    {nc.title}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {nc.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
