import { createFileRoute, Link } from "@tanstack/react-router";
import { Cpu, ShieldCheck, BarChart3, Globe, ArrowRight, Activity, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BidSwift AI — Procurement Intelligence" },
      { name: "description", content: "Enterprise procurement intelligence: tender risk audits, BoQ extraction, and Go/No-Go decision support for construction contractors." },
      { property: "og:title", content: "BidSwift AI — Procurement Intelligence" },
      { property: "og:description", content: "Bid the right tenders. Skip the rest." },
    ],
  }),
  component: Index,
});

function Label({ children }: { children: React.ReactNode }) {
  return <span className="label-xs text-slate-500">{children}</span>;
}

function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-900">
      {children}
    </div>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* NAV */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center bg-slate-900">
              <div className="h-2 w-2 bg-white" />
            </div>
            <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">
              BidSwift AI
            </span>
            <span className="ml-3 hidden label-xs text-slate-400 md:inline">
              / Procurement Intelligence
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              to="/auth"
              className="label-xs border border-slate-200 bg-white px-4 py-2.5 text-slate-900 transition-colors hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              Log in
            </Link>
            <Link
              to="/auth"
              className="label-xs flex items-center gap-2 border border-slate-900 bg-slate-900 px-4 py-2.5 text-white transition-colors hover:border-indigo-600 hover:bg-indigo-600"
            >
              Start free assessment
              <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative border-b border-slate-200">
        <div className="absolute inset-0 grid-bg pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="mb-10 flex items-center gap-3">
            <span className="inline-block h-1.5 w-1.5 bg-indigo-600" />
            <Label>System Online — Index v1.0.4</Label>
          </div>

          <h1 className="max-w-5xl text-5xl font-black uppercase tracking-tighter leading-[0.95] text-slate-900 md:text-7xl lg:text-[88px]">
            Bid the right<br />tenders.<br />
            <span className="text-slate-400">Skip the rest.</span>
          </h1>

          <p className="mt-10 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
            BidSwift AI turns raw tender documents into board-ready risk
            registers, Go/No-Go recommendations, and structured bills of
            quantities — before your estimators spend a single day pricing.
          </p>

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Link
              to="/auth"
              className="label-xs flex items-center gap-3 border border-slate-900 bg-slate-900 px-6 py-4 text-white transition-colors hover:border-indigo-600 hover:bg-indigo-600"
            >
              Run a tender assessment
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
            <button className="label-xs border border-slate-200 bg-white px-6 py-4 text-slate-900 transition-colors hover:border-slate-900">
              View Technical Brief
            </button>
          </div>

          {/* spec strip */}
          <div className="mt-20 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 md:grid-cols-4">
            {[
              ["Tender Volume", "$12.4B"],
              ["Active Pipelines", "184"],
              ["Risk Models", "27"],
              ["Latency", "1.2s"],
            ].map(([k, v]) => (
              <div key={k} className="bg-white px-5 py-5">
                <Label>{k}</Label>
                <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900">
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEURAL ENGINE */}
      <section className="border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-indigo-600" />
                <Label>Module 02 / Neural Engine</Label>
              </div>
              <h2 className="max-w-2xl text-3xl font-black uppercase tracking-tighter text-slate-900 md:text-5xl">
                The computational layer beneath every decision.
              </h2>
            </div>
            <div className="font-mono text-xs text-slate-400">
              REV. 2026.06 / CORE
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px border border-slate-200 bg-slate-200 md:grid-cols-3">
            {[
              {
                icon: <Cpu className="h-4 w-4" strokeWidth={2} />,
                label: "01 / BoQ Calibration",
                title: "Bill-of-Quantities Calibration",
                body: "Cross-referencing line items against regional market indices, supplier benchmarks, and historical cost performance.",
              },
              {
                icon: <ShieldCheck className="h-4 w-4" strokeWidth={2} />,
                label: "02 / Risk Indexing",
                title: "Contractual Risk Indexing",
                body: "Quantifying contractual and logistical slippage probability across the project lifecycle with deterministic models.",
              },
              {
                icon: <Globe className="h-4 w-4" strokeWidth={2} />,
                label: "03 / Terminal Pipeline",
                title: "Procurement Pipeline",
                body: "Integrated procurement feeds from ERA, PPSA, and ECAA, normalised into a single tender intelligence stream.",
              },
            ].map((c) => (
              <div key={c.label} className="group bg-white p-8 transition-colors hover:bg-zinc-50">
                <div className="flex items-center justify-between">
                  <IconBox>{c.icon}</IconBox>
                  <Label>{c.label}</Label>
                </div>
                <h3 className="mt-10 text-xl font-bold uppercase tracking-tight text-slate-900">
                  {c.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {c.body}
                </p>
                <div className="mt-10 flex items-center gap-2 border-t border-slate-200 pt-4 label-xs text-slate-400 group-hover:text-indigo-600">
                  Read Specification
                  <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ENGINEERING READOUT */}
      <section className="border-b border-slate-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-12 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-indigo-600" />
            <Label>Module 03 / Engineering Readout</Label>
          </div>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 md:text-5xl">
                Read a tender like a spec sheet.
              </h2>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-600">
                Every bid is decomposed into deterministic variables. The
                Engineering Readout surfaces variance, slippage exposure, and
                margin integrity in a single, audit-ready frame.
              </p>
              <div className="mt-10 space-y-3 border-t border-slate-200 pt-6">
                {[
                  ["Source", "PPSA-EX-2418"],
                  ["Issued", "2026.06.14 / 09:42Z"],
                  ["Analyst", "OP-2207"],
                  ["Compliance", "ISO 19650 / Tier 1"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between font-mono text-xs">
                    <span className="label-xs text-slate-400">{k}</span>
                    <span className="text-slate-900">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Readout panel */}
            <div className="border border-slate-300 bg-white">
              {/* terminal header */}
              <div className="flex items-center justify-between border-b border-slate-300 bg-slate-900 px-5 py-3">
                <div className="flex items-center gap-3">
                  <Activity className="h-3.5 w-3.5 text-indigo-400" strokeWidth={2.5} />
                  <span className="label-xs text-white">Engineering Readout · LIVE</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">VLT://stream/0x4F2A</span>
              </div>

              <div className="grid grid-cols-2 gap-px border-b border-slate-300 bg-slate-200">
                <div className="bg-white px-5 py-4">
                  <Label>Project ID</Label>
                  <div className="mt-1 font-mono text-sm font-bold text-slate-900">
                    AAU-MTR-PH3-204
                  </div>
                </div>
                <div className="bg-white px-5 py-4">
                  <Label>Contract Value</Label>
                  <div className="mt-1 font-mono text-sm font-bold text-slate-900">
                    USD 482,140,000
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-300 p-6">
                <div className="flex items-end justify-between">
                  <div>
                    <Label>Composite Risk Index</Label>
                    <div className="mt-2 font-black tracking-tighter text-slate-900 text-6xl">
                      67.4<span className="text-2xl text-slate-400">%</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <Label>Status</Label>
                    <div className="mt-2 inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-1.5 text-white">
                      <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
                      <span className="label-xs">Variance Detected</span>
                    </div>
                  </div>
                </div>

                {/* bar */}
                <div className="mt-6 h-1.5 w-full bg-slate-100">
                  <div className="h-full bg-indigo-600" style={{ width: "67.4%" }} />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-400">
                  <span>0.0</span>
                  <span>THRESHOLD 55.0</span>
                  <span>100.0</span>
                </div>
              </div>

              {/* line items */}
              <div className="divide-y divide-slate-200">
                {[
                  ["Earthworks / Excavation", "+4.20%", "NOMINAL"],
                  ["Reinforced Concrete C40", "+11.80%", "FLAGGED"],
                  ["Steel Reinforcement Bar", "+18.05%", "FLAGGED"],
                  ["MEP Subcontract Package", "+2.10%", "NOMINAL"],
                  ["Logistics & Mobilisation", "+7.60%", "WATCH"],
                ].map(([item, val, status]) => (
                  <div key={item} className="grid grid-cols-[1fr_auto_auto] items-center gap-6 px-5 py-3 font-mono text-xs">
                    <span className="text-slate-700">{item}</span>
                    <span className="text-slate-900">{val}</span>
                    <span
                      className={
                        "label-xs " +
                        (status === "FLAGGED"
                          ? "text-indigo-600"
                          : status === "WATCH"
                            ? "text-slate-900"
                            : "text-slate-400")
                      }
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-300 bg-zinc-50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} />
                  <span className="label-xs text-slate-500">Model VLT-Core 4.2</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  T+0.84s / 2,418 variables
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-slate-200">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-6 py-20 md:flex-row md:items-center">
          <div>
            <Label>For estimators, commercial managers & procurement teams</Label>
            <h3 className="mt-4 max-w-2xl text-3xl font-black uppercase tracking-tighter text-slate-900 md:text-4xl">
              Put every tender in your book through a 60-second risk assessment.
            </h3>
          </div>
          <Link
            to="/auth"
            className="label-xs flex items-center gap-3 border border-slate-900 bg-slate-900 px-6 py-4 text-white transition-colors hover:border-indigo-600 hover:bg-indigo-600"
          >
            Initiate System Audit
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-10 md:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center bg-slate-900">
              <div className="h-1.5 w-1.5 bg-white" />
            </div>
            <span className="label-xs text-slate-900">BidSwift AI</span>
          </div>
          <div className="font-mono text-[11px] text-slate-500 md:text-center">
            Restricted Proprietary System — Unauthorized access prohibited.
          </div>
          <div className="font-mono text-[11px] text-slate-400 md:text-right">
            BUILD v1.0.4 · SHA 0x4F2A · © 2026
          </div>
        </div>
      </footer>
    </div>
  );
}