"use client";
/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect, useRef } from "react";
import Shiki from "../shiki";
import { littkk } from "littkk";
import { ArrowUpRightIcon } from "../icons";

// --- Docs View Component ---
export default function DocsView({
  snippets,
}: {
  snippets: {
    quickstart: string;
    dependencyChain: string;
    patterns: string;
    apiModule: string;
    apiStart: string;
  };
}) {
  const [activeSection, setActiveSection] = useState("why");
  const navRef = useRef<HTMLDivElement>(null);

  const sections = [
    { id: "why", title: "Why TsdkArc" },
    { id: "quickstart", title: "Quickstart" },
    { id: "concepts", title: "Core Concepts" },
    { id: "playground", title: "Online Playground" },
    { id: "api", title: "API Reference" },
    { id: "dependency", title: "Dependency Chain" },
    { id: "patterns", title: "Patterns" },
    { id: "lifecycle", title: "Lifecycle" },
  ];

  useEffect(() => {
    const ctrl = littkk();
    return () => ctrl.destroy();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections
        .map((s) => document.getElementById(s.id))
        .filter(Boolean);
      let currentActive = sections[0].id;

      for (const el of sectionElements) {
        const rect = el!.getBoundingClientRect();
        if (rect.top <= 200) {
          currentActive = el!.id;
        }
      }
      setActiveSection(currentActive);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const activeBtn = document.getElementById(`nav-btn-${activeSection}`);
    const container = navRef.current;

    if (activeBtn && container) {
      const scrollLeft =
        activeBtn.offsetLeft -
        container.clientWidth / 2 +
        activeBtn.clientWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  }, [activeSection]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const isMobile = window.innerWidth < 768;
      const offset = isMobile ? 160 : 100;
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-7xl mx-auto py-12 flex flex-col md:flex-row gap-16">
      <aside
        className="w-full md:w-64 shrink-0 self-start sticky top-[75px] md:top-32 z-40 bg-white/95 md:bg-transparent py-4 md:py-0 mb-6 md:mb-0 md:px-0"
        data-scroll-top="0px">
        <div
          ref={navRef}
          className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide scroll-smooth px-6 md:px-12">
          {sections.map((sec) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                id={`nav-btn-${sec.id}`}
                onClick={() => scrollTo(sec.id)}
                className={`whitespace-nowrap md:whitespace-normal text-left px-4 md:pr-0 py-2 text-sm transition-all active:scale-95 rounded-lg ${
                  isActive
                    ? "text-black font-bold bg-gray-100"
                    : "font-medium text-gray-500 hover:text-black hover:bg-gray-50"
                }`}>
                {sec.title}
              </button>
            );
          })}
        </div>
      </aside>

      <article className="flex-1 space-y-24 pb-24 md:pt-0 md:px-12">
        <section id="why" className="space-y-6 px-6 md:px-0">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Why</h2>
          <p className="text-gray-600 leading-relaxed text-lg">
            Your application codebases grow, the code become coupled and messy —
            hard to reuse, hard to share.
            <strong className="text-black font-semibold mx-1">TsdkArc</strong>
            lets you compose modules like building blocks, nest them, and share
            them across projects.
          </p>
          <p className="text-gray-600 leading-relaxed text-lg">
            Each module declares what it needs and what it provides. Then
            calling{" "}
            <code className="bg-gray-100 px-1 rounded text-sm font-mono">
              start([modules])
            </code>{" "}
            resolves the full dependency graph, boots modules in order, and
            returns a typed context.
          </p>
        </section>

        <section id="quickstart" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-6 px-6 md:px-0">
            Quickstart
          </h2>
          <div className="bg-[#282A36] md:border border-gray-200 p-6 md:p-8 md:rounded-2xl overflow-x-auto mt-6">
            <Shiki
              className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
              path={`/snippets/quickstart.ts`}
              defaultValue={snippets.quickstart}
              lang="typescript"
            />
          </div>
        </section>

        <section id="concepts" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-6 px-6 md:px-0">
            Core Concepts
          </h2>
          <div className="overflow-hidden md:rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full text-left bg-white">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 font-semibold text-gray-500 uppercase tracking-widest text-xs w-1/4">
                    Term
                  </th>
                  <th className="px-6 py-4 font-semibold text-gray-500 uppercase tracking-widest text-xs">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    Slice
                  </td>
                  <td className="px-6 py-4 text-gray-600 leading-relaxed">
                    The shape a module adds to the shared context (
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-black font-mono">
                      {"{ key: Type }"}
                    </code>
                    )
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    Module
                  </td>
                  <td className="px-6 py-4 text-gray-600 leading-relaxed">
                    Declares dependencies, registers values, and optionally
                    tears them down
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    Context
                  </td>
                  <td className="px-6 py-4 text-gray-600 leading-relaxed">
                    The merged union of all slices — fully typed at each
                    module's boundary
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="playground" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-6 px-6 md:px-0">
            Online Playground
          </h2>

          <p className="pl-6 md:px-0 mb-6">
            <a
              className="text-sky-600 inline-flex items-center whitespace-nowrap"
              target="_blank"
              href="https://stackblitz.com/edit/vitejs-vite-kdennssf?file=src%2Ftsdkarc-demo.ts&terminal=dev">
              Visit online playground{" "}
              <span className="text-xs text-black px-1 md:hidden">
                (Better view on Desktop)
              </span>
              <ArrowUpRightIcon className="ml-1 size-5 text-gray-400 group-hover:text-black transition-colors shrink-0" />
            </a>
          </p>
        </section>

        <section id="api" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-6 px-6 md:px-0">
            API Reference
          </h2>

          <div className="space-y-4">
            <h3 className="text-xl font-bold px-6 md:px-0">defineModule</h3>
            <div className="bg-[#282A36] md:border border-gray-200 p-6 md:p-8 md:rounded-2xl overflow-x-auto">
              <Shiki
                className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
                path={`/snippets/api.ts`}
                defaultValue={snippets.apiModule}
                lang="typescript"
              />
            </div>
          </div>

          <div className="space-y-4 mt-12">
            <h3 className="text-xl font-bold px-6 md:px-0">start</h3>
            <div className="bg-[#282A36] md:border border-gray-200 p-6 md:p-8 md:rounded-2xl overflow-x-auto">
              <Shiki
                className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
                path={`/snippets/api-start.ts`}
                defaultValue={snippets.apiStart}
                lang="typescript"
              />
            </div>
          </div>
        </section>

        <section id="dependency" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-4 px-6 md:px-0">
            Dependency Chain
          </h2>
          <p className="text-gray-600 leading-relaxed text-lg px-6 md:px-0">
            Downstream modules declare upstream modules and get their context
            fully typed.{" "}
            <code className="bg-gray-100 px-1 rounded text-sm font-mono text-black">
              start()
            </code>{" "}
            walks the dependency graph and deduplicates — each module boots
            exactly once.
          </p>
          <div className="bg-[#282A36] md:border border-gray-200 p-6 md:p-8 md:rounded-2xl overflow-x-auto mt-6">
            <Shiki
              className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
              path={`/snippets/dependency-chain.ts`}
              defaultValue={snippets.dependencyChain}
              lang="typescript"
            />
          </div>
        </section>

        <section id="patterns" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-4 px-6 md:px-0">
            Patterns
          </h2>
          <div className="space-y-4">
            <h3 className="font-bold text-xl px-6 md:px-0">
              Register anything, not just data
            </h3>
            <p className="text-gray-600 text-lg px-6 md:px-0">
              Functions, class instances, and middleware are all valid context
              values.
            </p>
            <div className="bg-[#282A36] md:border border-gray-200 p-6 md:p-8 md:rounded-2xl overflow-x-auto mt-4">
              <Shiki
                className="text-sm font-mono text-gray-800 leading-relaxed pt-4 md:pt-0"
                path={`/snippets/patterns.ts`}
                defaultValue={snippets.patterns}
                lang="typescript"
              />
            </div>
          </div>
        </section>

        <section id="lifecycle" className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight mb-4 px-6 md:px-0">
            Lifecycle
          </h2>

          {/* Pipeline diagram */}
          <div className="bg-gray-50 md:border border-gray-200 p-6 md:p-8 md:rounded-2xl font-mono text-sm overflow-x-auto whitespace-nowrap text-gray-500 font-bold mb-8 shadow-sm">
            beforeBoot <span className="text-gray-300 font-normal px-1">→</span>{" "}
            boot <span className="text-gray-300 font-normal px-1">→</span>{" "}
            afterBoot <span className="text-gray-300 font-normal px-1">→</span>{" "}
            <span className="text-black bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">
              [running]
            </span>{" "}
            <span className="text-gray-300 font-normal px-1">→</span>{" "}
            beforeShutdown{" "}
            <span className="text-gray-300 font-normal px-1">→</span> shutdown{" "}
            <span className="text-gray-300 font-normal px-1">→</span>{" "}
            afterShutdown
          </div>

          <div className="overflow-x-auto md:rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full text-left bg-white">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 font-semibold text-gray-500 uppercase tracking-widest text-xs w-1/3 md:w-auto">
                    Hook
                  </th>
                  <th className="px-6 py-4 font-semibold text-gray-500 uppercase tracking-widest text-xs w-24 md:w-auto">
                    Fires
                  </th>
                  <th className="px-6 py-4 font-semibold text-gray-500 uppercase tracking-widest text-xs min-w-[200px]">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {/* Global hooks */}
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    beforeBoot
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">once</td>
                  <td className="px-6 py-4 text-gray-600">
                    Before the first module begins booting
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    afterBoot
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">once</td>
                  <td className="px-6 py-4 text-gray-600">
                    After the last module has finished booting — cross-module{" "}
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-black text-xs">
                      ctx
                    </code>{" "}
                    is ready
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    beforeShutdown
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">once</td>
                  <td className="px-6 py-4 text-gray-600">
                    Before the first module begins shutting down
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    afterShutdown
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">once</td>
                  <td className="px-6 py-4 text-gray-600">
                    After the last module has finished shutting down — final
                    cleanup
                  </td>
                </tr>

                {/* Divider row */}
                <tr className="bg-gray-50">
                  <td
                    colSpan={3}
                    className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    Per-module — fires once per module, in boot / shutdown order
                  </td>
                </tr>

                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    beforeEachBoot
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    per module
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    Before each individual module boots; receives the module as
                    the second argument
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    afterEachBoot
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    per module
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    After each individual module finishes booting; receives the
                    module as the second argument
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    beforeEachShutdown
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    per module
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    Before each individual module shuts down; receives the
                    module as the second argument
                  </td>
                </tr>
                <tr className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-black text-base">
                    afterEachShutdown
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    per module
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    After each individual module finishes shutting down;
                    receives the module as the second argument
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </article>
    </div>
  );
}
