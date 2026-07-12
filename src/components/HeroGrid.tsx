// src/components/HeroGrid.tsx — animated, cursor-reactive grid background wrapper for the hero.
// Rules: motion never gates data; static fallback when prefers-reduced-motion is set.
import { useCallback, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

export function HeroGrid({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (reduced) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [reduced],
  );

  return (
    <div
      className="relative"
      onMouseMove={handleMove}
      onMouseLeave={() => setPos(null)}
    >
      {/* visual layer — sits behind children, never intercepts clicks */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 grid-bg" />

        {/* slow ambient scan line, monochrome + indigo, off entirely for reduced motion */}
        {!reduced && (
          <motion.div
            className="absolute inset-y-0 w-px bg-indigo-600/25"
            initial={{ left: "0%" }}
            animate={{ left: ["0%", "100%"] }}
            transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
          />
        )}

        {/* cursor spotlight — brightens the grid near the pointer, fades out when idle */}
        {!reduced && (
          <div
            className="absolute inset-0 transition-opacity duration-500"
            style={{
              opacity: pos ? 1 : 0,
              background: pos
                ? `radial-gradient(480px circle at ${pos.x}px ${pos.y}px, rgba(79,70,229,0.14), transparent 70%)`
                : undefined,
              maskImage:
                "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, #000 0px, #000 1px, transparent 1px, transparent 40px)",
              WebkitMaskImage:
                "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, #000 0px, #000 1px, transparent 1px, transparent 40px)",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
          />
        )}
      </div>

      {children}
    </div>
  );
}
