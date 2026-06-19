/**
 * HeroConstruction.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Scroll-reactive construction graphic for the Valtor landing page hero.
 * Drop into the circled right-half of the hero section in src/routes/index.tsx.
 *
 * USAGE — inside the hero <section>, right column:
 *   <HeroConstruction />
 *
 * The component listens to window scroll and applies parallax transforms to
 * three independent SVG layers (road cross-section, building elevation, BoQ
 * sheet) + floating metadata tags. All animations are RAF-throttled and
 * respect prefers-reduced-motion. No extra deps required.
 */

import { useEffect, useRef } from "react";

export function HeroConstruction() {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const roadRef   = useRef<HTMLDivElement>(null);
  const buildRef  = useRef<HTMLDivElement>(null);
  const boqRef    = useRef<HTMLDivElement>(null);
  const tag1Ref   = useRef<HTMLDivElement>(null);
  const tag2Ref   = useRef<HTMLDivElement>(null);
  const tag3Ref   = useRef<HTMLDivElement>(null);
  const tag4Ref   = useRef<HTMLDivElement>(null);
  const tag5Ref   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap  = wrapRef.current;
    const road  = roadRef.current;
    const build = buildRef.current;
    const boq   = boqRef.current;

    if (!wrap) return;

    // Respect reduced motion
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let ticking = false;

    const update = () => {
      const rect     = wrap.getBoundingClientRect();
      const vh       = window.innerHeight;
      // progress: 0 = element bottom at viewport bottom, 1 = element top at viewport top
      const progress = Math.max(0, Math.min(1,
        1 - (rect.top + rect.height * 0.5) / (vh + rect.height)
      ));
      const p = progress;

      // Layers move at different speeds — road drifts down, building drifts up-right,
      // BoQ sheet lifts and tilts slightly
      if (road)  road.style.transform  = `translateY(${p * 40}px)`;
      if (build) build.style.transform = `translateY(${p * -24}px) translateX(${p * 8}px)`;
      if (boq)   boq.style.transform   = `translateY(${p * -14}px) rotate(${p * -0.8}deg)`;

      // Tags scatter at different rates
      const t1 = tag1Ref.current;
      const t2 = tag2Ref.current;
      const t3 = tag3Ref.current;
      const t4 = tag4Ref.current;
      const t5 = tag5Ref.current;
      if (t1) t1.style.transform = `translateY(${p * -20}px)`;
      if (t2) t2.style.transform = `translateY(${p * -30}px) translateX(${p * -6}px)`;
      if (t3) t3.style.transform = `translateY(${p * 22}px)`;
      if (t4) t4.style.transform = `translateY(${p * 18}px) translateX(${p * 4}px)`;
      if (t5) t5.style.transform = `translateY(${p * -16}px)`;

      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update(); // initial paint

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Shared inline styles ────────────────────────────────────────────────────
  const layerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    willChange: "transform",
    pointerEvents: "none",
  };

  const tagBase: React.CSSProperties = {
    position: "absolute",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    padding: "2px 7px",
    whiteSpace: "nowrap",
    borderRadius: "2px",
    pointerEvents: "none",
    willChange: "transform",
  };

  const tagIndigo: React.CSSProperties = {
    ...tagBase,
    color: "#6366f1",
    background: "rgba(99,102,241,0.07)",
    border: "1px solid rgba(99,102,241,0.2)",
  };

  const tagMuted: React.CSSProperties = {
    ...tagBase,
    color: "#94a3b8",
    background: "rgba(148,163,184,0.06)",
    border: "1px solid rgba(148,163,184,0.18)",
  };

  const tagRisk: React.CSSProperties = {
    ...tagBase,
    color: "#ef4444",
    background: "rgba(239,68,68,0.06)",
    border: "1px solid rgba(239,68,68,0.2)",
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height: "520px",
        overflow: "hidden",
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      {/* ── Layer 0: Background grid (static) ───────────────────────────── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg
          width="100%"
          viewBox="0 0 680 520"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <pattern id="vgrid40" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="rgba(99,102,241,0.07)" strokeWidth="0.5" />
            </pattern>
            <pattern id="vgrid8" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="0.6" fill="rgba(148,163,184,0.25)" />
            </pattern>
          </defs>
          <rect width="680" height="520" fill="url(#vgrid40)" />
          <rect width="680" height="520" fill="url(#vgrid8)" />
          {/* Horizon reference */}
          <line
            x1="0" y1="340" x2="680" y2="340"
            stroke="rgba(148,163,184,0.12)"
            strokeWidth="0.5"
            strokeDasharray="4 6"
          />
        </svg>
      </div>

      {/* ── Layer 1: Road cross-section (parallax — drifts down) ─────────── */}
      <div ref={roadRef} style={layerStyle}>
        <svg
          width="100%"
          viewBox="0 0 680 520"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <clipPath id="csub">
              <rect x="30" y="410" width="620" height="18" />
            </clipPath>
            <marker
              id="vdimArr"
              viewBox="0 0 8 8"
              refX="4"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M1 1L7 4L1 7" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="1.2" />
            </marker>
          </defs>
          <g transform="translate(30,360)">
            {/* Sub-base */}
            <rect x="0" y="50" width="620" height="18" fill="rgba(148,163,184,0.12)" stroke="rgba(148,163,184,0.3)" strokeWidth="0.5" />
            {/* Base course */}
            <rect x="10" y="30" width="600" height="22" fill="rgba(99,102,241,0.06)" stroke="rgba(99,102,241,0.22)" strokeWidth="0.5" />
            {/* Binder course */}
            <rect x="20" y="14" width="580" height="18" fill="rgba(99,102,241,0.09)" stroke="rgba(99,102,241,0.28)" strokeWidth="0.5" />
            {/* Wearing course */}
            <rect x="20" y="0" width="580" height="16" fill="rgba(15,34,64,0.08)" stroke="rgba(15,34,64,0.22)" strokeWidth="0.5" />
            {/* Centre line */}
            <line x1="310" y1="-4" x2="310" y2="2" stroke="rgba(99,102,241,0.5)" strokeWidth="1" strokeDasharray="12 8" />
            {/* Width dim line */}
            <line x1="0" y1="-12" x2="620" y2="-12" stroke="rgba(148,163,184,0.4)" strokeWidth="0.5" markerStart="url(#vdimArr)" markerEnd="url(#vdimArr)" />
            {/* Kerbs */}
            <rect x="-6" y="0" width="8" height="16" fill="rgba(148,163,184,0.25)" stroke="rgba(148,163,184,0.4)" strokeWidth="0.5" rx="1" />
            <rect x="618" y="0" width="8" height="16" fill="rgba(148,163,184,0.25)" stroke="rgba(148,163,184,0.4)" strokeWidth="0.5" rx="1" />
            {/* Sub-base hatching */}
            {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520, 560].map((x) => (
              <line key={x} x1={x - 10} y1="50" x2={x + 30} y2="68" stroke="rgba(148,163,184,0.25)" strokeWidth="0.5" />
            ))}
            {/* Labels */}
            <text x="310" y="-18" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="8" fill="rgba(148,163,184,0.6)" letterSpacing="0.15em">CARRIAGEWAY WIDTH — 14.0M</text>
            <text x="-14" y="12" textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(99,102,241,0.55)">WC</text>
            <text x="-14" y="28" textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(99,102,241,0.55)">BC</text>
            <text x="-14" y="44" textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(99,102,241,0.45)">BASE</text>
            <text x="-14" y="62" textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.5)">SUB</text>
          </g>
        </svg>
      </div>

      {/* ── Layer 2: Building elevation (parallax — lifts up-right) ──────── */}
      <div ref={buildRef} style={layerStyle}>
        <svg
          width="100%"
          viewBox="0 0 680 520"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: "absolute", inset: 0 }}
        >
          <g transform="translate(400,60)">
            {/* Shell */}
            <rect x="0" y="0" width="220" height="280" fill="rgba(255,255,255,0.04)" stroke="rgba(15,34,64,0.3)" strokeWidth="0.8" />
            {/* Floor lines */}
            {[46, 92, 138, 184, 230].map((y) => (
              <line key={y} x1="0" y1={y} x2="220" y2={y} stroke="rgba(99,102,241,0.2)" strokeWidth="0.5" strokeDasharray="3 5" />
            ))}
            {/* Columns */}
            {[0, 54, 108, 162, 212].map((x, i) => (
              <rect key={x} x={x} y="0" width="8" height="280" fill={i === 0 || i === 4 ? "rgba(15,34,64,0.12)" : "rgba(15,34,64,0.08)"} stroke={i === 0 || i === 4 ? "rgba(15,34,64,0.2)" : "rgba(15,34,64,0.15)"} strokeWidth="0.5" />
            ))}
            {/* Window grid — 4 cols × 5 rows */}
            {[10, 56, 102, 148, 194].map((y, row) =>
              [20, 68, 122, 176].map((x, col) => {
                const flagged = (row === 1 && col === 3) || (row === 3 && col === 3);
                return (
                  <rect
                    key={`${row}-${col}`}
                    x={x} y={y}
                    width="28" height="28"
                    fill={flagged ? "rgba(239,68,68,0.08)" : "rgba(99,102,241,0.06)"}
                    stroke={flagged ? "rgba(239,68,68,0.35)" : "rgba(99,102,241,0.22)"}
                    strokeWidth="0.5"
                    rx="1"
                  />
                );
              })
            )}
            {/* Door */}
            <rect x="88" y="248" width="44" height="32" fill="rgba(15,34,64,0.06)" stroke="rgba(15,34,64,0.25)" strokeWidth="0.5" />
            {/* Floor labels */}
            {["F5","F4","F3","F2","F1","G"].map((label, i) => (
              <text key={label} x="-6" y={28 + i * 46} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.5)">{label}</text>
            ))}
            {/* Risk flag */}
            <text x="214" y="72" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(239,68,68,0.7)">⚑</text>
            {/* Title */}
            <text x="110" y="-10" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill="rgba(148,163,184,0.45)" letterSpacing="0.18em">ELEVATION — EAST FACADE</text>
            {/* Vertical dim */}
            <line x1="232" y1="0" x2="232" y2="280" stroke="rgba(148,163,184,0.3)" strokeWidth="0.5" />
            <line x1="228" y1="0" x2="236" y2="0" stroke="rgba(148,163,184,0.3)" strokeWidth="0.5" />
            <line x1="228" y1="280" x2="236" y2="280" stroke="rgba(148,163,184,0.3)" strokeWidth="0.5" />
            <text x="240" y="142" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.45)">18.4M</text>
          </g>
        </svg>
      </div>

      {/* ── Layer 3: BoQ sheet (parallax — lifts + slight tilt) ──────────── */}
      <div ref={boqRef} style={layerStyle}>
        <svg
          width="100%"
          viewBox="0 0 680 520"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: "absolute", inset: 0 }}
        >
          <g transform="translate(30,40)">
            {/* Sheet body */}
            <rect x="0" y="0" width="290" height="360" fill="rgba(255,255,255,0.72)" stroke="rgba(15,34,64,0.18)" strokeWidth="0.8" rx="1" />
            <rect x="4" y="4" width="282" height="352" fill="none" stroke="rgba(15,34,64,0.06)" strokeWidth="0.5" rx="1" />
            {/* Title strip */}
            <rect x="0" y="0" width="290" height="22" fill="rgba(15,34,64,0.06)" rx="1" />
            <text x="8" y="14" fontFamily="'JetBrains Mono',monospace" fontSize="8" fill="rgba(15,34,64,0.6)" letterSpacing="0.14em" fontWeight="700">BILL OF QUANTITIES — DIV-02 STRUCTURAL</text>
            {/* Column headers */}
            <line x1="0" y1="30" x2="290" y2="30" stroke="rgba(15,34,64,0.1)" strokeWidth="0.5" />
            {[
              { x: 8,   anchor: "start", label: "REF" },
              { x: 38,  anchor: "start", label: "DESCRIPTION" },
              { x: 190, anchor: "end",   label: "QTY" },
              { x: 225, anchor: "end",   label: "RATE" },
              { x: 283, anchor: "end",   label: "TOTAL" },
            ].map(({ x, anchor, label }) => (
              <text key={label} x={x} y="40" textAnchor={anchor as any} fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.7)" letterSpacing="0.12em">{label}</text>
            ))}
            <line x1="0" y1="44" x2="290" y2="44" stroke="rgba(15,34,64,0.08)" strokeWidth="0.5" />

            {/* BoQ Rows */}
            {[
              { id: "S01", desc: "RC C40/50 Foundations", qty: "3,200", rate: "1,840", total: "$5.89M", risk: false, y: 56 },
              { id: "S02", desc: "RC C35 Columns",        qty: "820",   rate: "2,100", total: "$1.72M", risk: true,  y: 72 },
              { id: "S03", desc: "Post-tensioned Slabs",  qty: "14,800",rate: "1,240", total: "$18.35M",risk: false, y: 88 },
              { id: "S04", desc: "Steel Rebar Y32",       qty: "2,840", rate: "1,920", total: "$5.45M", risk: true,  y: 104 },
              { id: "S05", desc: "Structural Formwork",   qty: "22,400",rate: "380",   total: "$8.51M", risk: false, y: 120 },
            ].map(({ id, desc, qty, rate, total, risk, y }) => (
              <g key={id}>
                {risk && <rect x="0" y={y - 10} width="290" height="14" fill="rgba(239,68,68,0.06)" />}
                <text x="8"   y={y} fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill={risk ? "rgba(239,68,68,0.85)" : "rgba(99,102,241,0.7)"}>{id}</text>
                <text x="38"  y={y} fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill="rgba(15,34,64,0.7)">{desc}</text>
                <text x="190" y={y} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill="rgba(15,34,64,0.65)">{qty}</text>
                <text x="225" y={y} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill={risk ? "rgba(239,68,68,0.8)" : "rgba(15,34,64,0.65)"}>{rate}</text>
                <text x="283" y={y} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill={risk ? "rgba(239,68,68,0.95)" : "rgba(15,34,64,0.8)"} fontWeight="700">{total}</text>
                {risk && <text x="287" y={y - 1} fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(239,68,68,0.85)">⚑</text>}
                <line x1="0" y1={y + 4} x2="290" y2={y + 4} stroke="rgba(15,34,64,0.04)" strokeWidth="0.5" />
              </g>
            ))}

            {/* Variance bars */}
            <line x1="0" y1="134" x2="290" y2="134" stroke="rgba(15,34,64,0.08)" strokeWidth="0.5" />
            <text x="8" y="146" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.6)" letterSpacing="0.12em">MARKET VARIANCE INDEX</text>
            {[
              { label: "Rebar Y32", width: 120, color: "rgba(239,68,68,0.55)", textColor: "rgba(239,68,68,0.9)", pct: "+18.1%", y: 154 },
              { label: "PT Slabs",  width: 92,  color: "rgba(245,158,11,0.5)", textColor: "rgba(245,158,11,0.9)", pct: "+14.2%", y: 168 },
              { label: "Piling",    width: 72,  color: "rgba(99,102,241,0.4)", textColor: "rgba(99,102,241,0.85)",pct: "+11.4%", y: 182 },
            ].map(({ label, width, color, textColor, pct, y }) => (
              <g key={label}>
                <text x="8" y={y + 8} fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill="rgba(15,34,64,0.6)">{label}</text>
                <rect x="80" y={y} width="148" height="7" fill="rgba(15,34,64,0.05)" rx="1" />
                <rect x="80" y={y} width={width} height="7" fill={color} rx="1" />
                <text x="234" y={y + 8} fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill={textColor} fontWeight="700">{pct}</text>
              </g>
            ))}

            {/* Section subtotal */}
            <rect x="0" y="202" width="290" height="18" fill="rgba(15,34,64,0.04)" />
            <line x1="0" y1="202" x2="290" y2="202" stroke="rgba(15,34,64,0.12)" strokeWidth="0.8" />
            <text x="8"   y="215" fontFamily="'JetBrains Mono',monospace" fontSize="7.5" fill="rgba(15,34,64,0.6)" letterSpacing="0.1em">SECTION SUBTOTAL — DIV-02</text>
            <text x="283" y="215" textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize="8" fill="rgba(15,34,64,0.9)" fontWeight="700">$39.92M</text>

            {/* CRI gauge */}
            <line x1="0" y1="230" x2="290" y2="230" stroke="rgba(15,34,64,0.08)" strokeWidth="0.5" />
            <text x="8" y="244" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.6)" letterSpacing="0.12em">COMPOSITE RISK INDEX</text>
            <rect x="8" y="250" width="230" height="10" fill="rgba(15,34,64,0.05)" rx="2" />
            <rect x="8" y="250" width="140" height="10" fill="rgba(239,68,68,0.25)" rx="2" />
            <rect x="8" y="250" width="88"  height="10" fill="rgba(99,102,241,0.3)"  rx="2" />
            <line x1="148" y1="246" x2="148" y2="264" stroke="rgba(239,68,68,0.9)" strokeWidth="1.2" />
            <text x="248" y="260" fontFamily="'JetBrains Mono',monospace" fontSize="9" fill="rgba(239,68,68,0.95)" fontWeight="700">67/100</text>
            <text x="8" y="274" fontFamily="'JetBrains Mono',monospace" fontSize="7" fill="rgba(148,163,184,0.45)">LOW ←————————→ CRITICAL</text>

            {/* Audit stamp */}
            <rect x="180" y="280" width="102" height="70" fill="none" stroke="rgba(99,102,241,0.2)" strokeWidth="0.8" strokeDasharray="2 3" rx="2" />
            <text x="231" y="298" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="6.5" fill="rgba(99,102,241,0.4)" letterSpacing="0.16em">VALTOR</text>
            <text x="231" y="310" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="6" fill="rgba(99,102,241,0.35)" letterSpacing="0.1em">AUDIT CERTIFIED</text>
            <text x="231" y="322" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="6" fill="rgba(148,163,184,0.4)">2026-06-19</text>
            <text x="231" y="340" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="5.5" fill="rgba(148,163,184,0.35)" letterSpacing="0.08em">PPSA-EX-2418</text>
          </g>
        </svg>
      </div>

      {/* ── Floating metadata tags ─────────────────────────────────────────── */}
      <div ref={tag1Ref} style={{ ...tagIndigo, top: "62px",  left: "336px" }}>CRI: 67/100</div>
      <div ref={tag2Ref} style={{ ...tagRisk,   top: "128px", right: "24px" }}>FLAGGED — S04</div>
      <div ref={tag3Ref} style={{ ...tagMuted,  bottom: "132px", left: "328px" }}>WC 50MM</div>
      <div ref={tag4Ref} style={{ ...tagIndigo, bottom: "182px", right: "28px" }}>+18.1% VARIANCE</div>
      <div ref={tag5Ref} style={{ ...tagMuted,  top: "32px",  right: "130px" }}>ELEVATION — EA</div>
    </div>
  );
}
