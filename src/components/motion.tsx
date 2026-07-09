// src/components/motion.tsx — shared animation primitives for BidSwift AI.
// Rules: motion never gates data; every component has a reduced-motion static fallback.
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { CheckCircle2 } from "lucide-react";

// ─── Count-up ─────────────────────────────────────────────────────────────────

export function useCountUp(target: number, duration = 700) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setValue(target * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return value;
}

export function CountUp({ value, format }: { value: number; format?: (v: number) => string }) {
  const v = useCountUp(value);
  return <>{format ? format(v) : Math.round(v).toLocaleString()}</>;
}

// ─── Score reveal (scale-in + count-up) ───────────────────────────────────────

export function AnimatedScore({ value, suffix, color, fontSize = "1.75rem" }: {
  value: number; suffix?: ReactNode; color: string; fontSize?: string;
}) {
  const reduced = useReducedMotion();
  const shown = Math.round(useCountUp(value));
  const inner = (
    <span style={{ fontSize, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "'JetBrains Mono','Fira Code',monospace", display: "inline-block" }}>
      {shown}{suffix}
    </span>
  );
  if (reduced) return inner;
  return (
    <motion.span
      initial={{ scale: 0.65, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{ display: "inline-block" }}
    >
      {inner}
    </motion.span>
  );
}

// ─── Staggered reveal ─────────────────────────────────────────────────────────

export function StaggeredList({ children, className, style, delay = 0, stagger = 0.12 }: {
  children: ReactNode; className?: string; style?: CSSProperties; delay?: number; stagger?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div
      className={className} style={style}
      initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, style, sharp = false }: {
  children: ReactNode; className?: string; style?: CSSProperties;
  /** sharp = urgent entrance (critical findings); soft = default */
  sharp?: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div
      className={className} style={style}
      variants={{
        hidden: sharp ? { opacity: 0, x: -14 } : { opacity: 0, y: 10 },
        show: sharp
          ? { opacity: 1, x: 0, transition: { type: "spring", stiffness: 520, damping: 26 } }
          : { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" } },
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── Collapsible (animated height, never hides data behind motion) ───────────

export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return open ? <div>{children}</div> : null;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Staged processing indicator (no blob spinners) ──────────────────────────

export function ProcessingStages({ stages, hint }: { stages: string[]; hint?: string }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);

  // Advance stages on a heartbeat; the final stage holds until real data unmounts us.
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((a) => Math.min(a + 1, stages.length - 1)), 1800);
    return () => clearInterval(id);
  }, [stages.length, reduced]);

  return (
    <div style={{ maxWidth: 360, margin: "0 auto", textAlign: "left", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {stages.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.625rem", fontSize: "0.8125rem", color: done ? "#15803D" : current ? "#0F2240" : "#9CA3AF", fontWeight: current ? 700 : 500 }}>
            {done ? (
              reduced ? <CheckCircle2 size={15} /> : (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }} style={{ display: "flex" }}>
                  <CheckCircle2 size={15} />
                </motion.span>
              )
            ) : current ? (
              reduced ? <span style={{ width: 15, textAlign: "center" }}>•</span> : (
                <motion.span
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.55, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: 9, height: 9, margin: 3, borderRadius: "50%", background: "#1D4ED8", display: "inline-block" }}
                />
              )
            ) : (
              <span style={{ width: 9, height: 9, margin: 3, borderRadius: "50%", background: "#E4E7EC", display: "inline-block" }} />
            )}
            {s}
          </div>
        );
      })}
      {hint && <p style={{ fontSize: "0.6875rem", color: "#9CA3AF", marginTop: "0.5rem" }}>{hint}</p>}
    </div>
  );
}

// ─── Clean-audit payoff ───────────────────────────────────────────────────────

export function CleanAuditBeat() {
  const reduced = useReducedMotion();
  const body = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "0.875rem 1.125rem" }}>
      <CheckCircle2 size={20} color="#15803D" />
      <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 700, color: "#15803D" }}>
        Clean assessment — no critical or high-severity findings. This tender is in good shape.
      </p>
    </div>
  );
  if (reduced) return body;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 16, delay: 0.35 }}>
      {body}
    </motion.div>
  );
}

export { motion, AnimatePresence, useReducedMotion };
