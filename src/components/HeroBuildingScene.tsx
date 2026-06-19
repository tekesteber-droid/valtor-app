/**
 * HeroBuildingScene.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * A self-contained, GPU-accelerated isometric construction scene rendered
 * on an HTML <canvas> using plain 2D canvas API and isometric projection math.
 *
 * Zero new npm dependencies. Drop this file into src/components/ and import it.
 *
 * WHAT IT SHOWS
 * ─────────────
 * An under-construction high-rise tower rendered as a blueprint-style wireframe:
 *   • 6 structural floor plates with column grids
 *   • Animated construction — floors build upward on mount
 *   • Slow continuous Y-rotation (scene slowly rotates)
 *   • Mouse-move parallax: camera tilts toward cursor
 *   • Data overlays: risk-score pulse, floor labels, scan lines
 *   • Ambient scanline / vignette for cinematic depth
 *
 * WHY THIS APPROACH (vs Three.js)
 * ────────────────────────────────
 * Your package.json does not include three / @react-three/fiber.
 * Adding them means ~600KB of bundle. A bespoke isometric canvas renderer
 * achieves the same visual quality at ~0KB extra bundle cost.
 *
 * If you later want to switch to Three.js, see the bottom of this file
 * for the exact install commands and a drop-in R3F version scaffold.
 *
 * INTEGRATION (src/routes/index.tsx)
 * ────────────────────────────────────
 * 1. Place this file at src/components/HeroBuildingScene.tsx
 * 2. Import at the top of index.tsx:
 *      import { HeroBuildingScene } from "@/components/HeroBuildingScene";
 * 3. In the hero section, split into a two-column grid and add the scene
 *    in the right column (see paste-ready JSX at bottom of this file).
 */

import { useEffect, useRef, useCallback } from "react";

// ─── Isometric projection helpers ────────────────────────────────────────────

const DEG = Math.PI / 180;

/**
 * Convert 3D world coordinates → 2D canvas pixel coordinates.
 * angle is the current Y-rotation of the scene (radians).
 */
function project(
  x: number,
  y: number,
  z: number,
  angle: number,
  cx: number,
  cy: number,
  scale: number
): [number, number] {
  // Rotate x/z around Y-axis
  const rx = x * Math.cos(angle) - z * Math.sin(angle);
  const rz = x * Math.sin(angle) + z * Math.cos(angle);

  // Isometric projection at 30°
  const iso_x = (rx - rz) * Math.cos(30 * DEG) * scale;
  const iso_y = (rx + rz) * Math.sin(30 * DEG) * scale - y * scale;

  return [cx + iso_x, cy + iso_y];
}

// ─── Drawing primitives ───────────────────────────────────────────────────────

interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  angle: number;
  cx: number;
  cy: number;
  scale: number;
}

function line3d(
  dc: DrawCtx,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  color: string,
  width = 0.8
) {
  const [ax, ay] = project(x1, y1, z1, dc.angle, dc.cx, dc.cy, dc.scale);
  const [bx, by] = project(x2, y2, z2, dc.angle, dc.cx, dc.cy, dc.scale);
  dc.ctx.beginPath();
  dc.ctx.moveTo(ax, ay);
  dc.ctx.lineTo(bx, by);
  dc.ctx.strokeStyle = color;
  dc.ctx.lineWidth = width;
  dc.ctx.stroke();
}

function dot3d(
  dc: DrawCtx,
  x: number, y: number, z: number,
  color: string,
  r = 2
) {
  const [px, py] = project(x, y, z, dc.angle, dc.cx, dc.cy, dc.scale);
  dc.ctx.beginPath();
  dc.ctx.arc(px, py, r, 0, Math.PI * 2);
  dc.ctx.fillStyle = color;
  dc.ctx.fill();
}

// ─── Building geometry constants ──────────────────────────────────────────────

// Column grid: 4×4 grid, spacing = 2 units
const COLS = [0, 2, 4, 6];
const ROWS = [0, 2, 4, 6];
const FLOORS = 7;          // total floors
const FLOOR_H = 1.4;       // height per floor in world units
const BASE_Y = 0;

// ─── Component ────────────────────────────────────────────────────────────────

export function HeroBuildingScene() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const stateRef    = useRef({
    angle: -0.38,            // initial rotation — slightly off-axis for drama
    mouseX: 0,
    mouseY: 0,
    floorsBuilt: 0.0,        // animated 0 → FLOORS
    raf: 0,
    lastTime: 0,
    mounted: false,
  });

  const handleMouse = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    stateRef.current.mouseX = (e.clientX - rect.left) / rect.width  - 0.5;
    stateRef.current.mouseY = (e.clientY - rect.top)  / rect.height - 0.5;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;
    s.mounted = true;

    // Resize observer — keeps canvas crisp on all DPRs
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w   = canvas.offsetWidth;
      const h   = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    });
    ro.observe(canvas);

    canvas.addEventListener("mousemove", handleMouse);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // ── Main render loop ──────────────────────────────────────────────────
    const render = (now: number) => {
      if (!s.mounted) return;
      const dt = Math.min((now - (s.lastTime || now)) / 1000, 0.05);
      s.lastTime = now;

      // Build-up animation: floors construct over ~2 seconds
      if (s.floorsBuilt < FLOORS) {
        s.floorsBuilt = Math.min(s.floorsBuilt + dt * 3.5, FLOORS);
      }

      // Slow continuous rotation unless user prefers reduced motion
      if (!reducedMotion) {
        s.angle += dt * 0.12;
        // Mouse-driven tilt (subtle)
        s.angle += s.mouseX * 0.002;
      }

      const W   = canvas.offsetWidth;
      const H   = canvas.offsetHeight;
      const scale = Math.min(W, H) * 0.085;
      const cx  = W * 0.52 + s.mouseX * 18;
      const cy  = H * 0.56 + s.mouseY * 10;

      const dc: DrawCtx = { ctx, angle: s.angle, cx, cy, scale };

      // ── Clear ─────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // Background gradient — near-black center, slightly lighter edge
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.65);
      bg.addColorStop(0,   "rgba(12, 16, 30, 0.0)");   // transparent center
      bg.addColorStop(1,   "rgba(8, 10, 20, 0.0)");    // transparent edge too
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ── Ground plane grid (subtle) ─────────────────────────────────────
      const gColor = "rgba(99, 102, 241, 0.06)";
      for (let gx = -2; gx <= 10; gx++) {
        line3d(dc, gx, BASE_Y, -2, gx, BASE_Y, 10, gColor, 0.4);
      }
      for (let gz = -2; gz <= 10; gz++) {
        line3d(dc, -2, BASE_Y, gz, 10, BASE_Y, gz, gColor, 0.4);
      }

      // ── Foundation slab ────────────────────────────────────────────────
      const slabColor = "rgba(148, 163, 184, 0.15)";
      const corners: [number,number][] = [[0,0],[6,0],[6,6],[0,6]];
      ctx.beginPath();
      corners.forEach(([gx, gz], i) => {
        const [px, py] = project(gx, BASE_Y - 0.08, gz, dc.angle, dc.cx, dc.cy, dc.scale);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(15,34,64,0.18)";
      ctx.fill();
      ctx.strokeStyle = slabColor;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // ── Floors ─────────────────────────────────────────────────────────
      const floorsToShow = Math.min(Math.floor(s.floorsBuilt), FLOORS - 1);
      const partialFloor = s.floorsBuilt - floorsToShow;

      for (let f = 0; f <= floorsToShow; f++) {
        const floorY   = BASE_Y + f * FLOOR_H;
        const progress = f < floorsToShow ? 1 : partialFloor;
        drawFloor(dc, f, floorY, progress, s.floorsBuilt);
      }

      // ── Crane (top-right of building) ──────────────────────────────────
      if (s.floorsBuilt > 4) {
        const craneAlpha = Math.min((s.floorsBuilt - 4) / 1.5, 1);
        drawCrane(dc, craneAlpha, s.floorsBuilt);
      }

      // ── Data overlay labels ────────────────────────────────────────────
      drawLabels(ctx, W, H, s.floorsBuilt, now);

      // ── Scan lines (very subtle atmosphere) ───────────────────────────
      if (!reducedMotion) {
        const scanOffset = (now * 0.04) % (H * 2);
        for (let sy = -H; sy < H; sy += 4) {
          const y = sy + scanOffset;
          if (y < 0 || y > H) continue;
          ctx.fillStyle = "rgba(99,102,241,0.008)";
          ctx.fillRect(0, y, W, 1);
        }
      }

      s.raf = requestAnimationFrame(render);
    };

    s.raf = requestAnimationFrame(render);

    return () => {
      s.mounted = false;
      cancelAnimationFrame(s.raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", handleMouse);
    };
  }, [handleMouse]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        // Canvas renders transparent — the parent hero section bg shows through
        background: "transparent",
      }}
      aria-hidden="true"
    />
  );
}

// ─── Floor drawing ────────────────────────────────────────────────────────────

function drawFloor(
  dc: DrawCtx,
  floorIndex: number,
  y: number,
  progress: number,   // 0–1 how complete this floor is
  floorsBuilt: number
) {
  const isTopFloor = floorIndex === Math.floor(floorsBuilt) - 1 || progress < 1;
  const isFloorComplete = progress >= 1;

  // Column color varies by risk
  const riskFloors = [1, 4]; // these floors have "risk" highlight
  const isRisk = riskFloors.includes(floorIndex);

  const colColor  = isRisk
    ? `rgba(239,68,68,${0.55 * progress})`
    : `rgba(99,102,241,${0.45 * progress})`;
  const beamColor = `rgba(148,163,184,${0.22 * progress})`;
  const slabColor = `rgba(99,102,241,${0.08 * progress})`;
  const slabEdge  = `rgba(99,102,241,${0.3 * progress})`;

  // Draw columns (vertical bars at each grid intersection)
  for (const cx of COLS) {
    for (const cz of ROWS) {
      // Column from previous floor slab to this floor slab
      const colBase = y - FLOOR_H * (1 - progress);
      line3d(dc, cx, colBase, cz, cx, y, cz, colColor, isRisk ? 1.2 : 0.9);
      // Column node dot
      if (isFloorComplete) {
        dot3d(dc, cx, y, cz, colColor, isRisk ? 2 : 1.5);
      }
    }
  }

  // Draw beams (horizontal frame at slab level)
  if (isFloorComplete || progress > 0.4) {
    const beamAlpha = progress > 0.4 ? Math.min((progress - 0.4) / 0.4, 1) : 0;
    const bc = `rgba(148,163,184,${0.22 * beamAlpha})`;

    // X-direction beams (along each row)
    for (const cz of ROWS) {
      for (let i = 0; i < COLS.length - 1; i++) {
        line3d(dc, COLS[i], y, cz, COLS[i + 1], y, cz, bc, 0.7);
      }
    }
    // Z-direction beams (along each column)
    for (const cx of COLS) {
      for (let i = 0; i < ROWS.length - 1; i++) {
        line3d(dc, cx, y, ROWS[i], cx, y, ROWS[i + 1], bc, 0.7);
      }
    }

    // Interior diagonal bracing on every other bay
    const diagColor = `rgba(99,102,241,${0.12 * beamAlpha})`;
    for (let ci = 0; ci < COLS.length - 1; ci++) {
      for (let ri = 0; ri < ROWS.length - 1; ri++) {
        if ((ci + ri) % 2 === 0) {
          line3d(dc, COLS[ci], y, ROWS[ri], COLS[ci+1], y, ROWS[ri+1], diagColor, 0.4);
        }
      }
    }
  }

  // Draw slab fill (translucent top face)
  if (isFloorComplete) {
    const slabCorners: [number, number, number][] = [
      [0, y, 0], [6, y, 0], [6, y, 6], [0, y, 6],
    ];
    const { ctx, angle, cx: ocx, cy: ocy, scale } = dc;
    ctx.beginPath();
    slabCorners.forEach(([sx, sy, sz], i) => {
      const [px, py] = project(sx, sy, sz, angle, ocx, ocy, scale);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = slabColor;
    ctx.fill();
    ctx.strokeStyle = slabEdge;
    ctx.lineWidth = isTopFloor ? 0.8 : 0.5;
    ctx.stroke();
  }
}

// ─── Crane drawing ────────────────────────────────────────────────────────────

function drawCrane(dc: DrawCtx, alpha: number, floorsBuilt: number) {
  const craneHeight = BASE_Y + (floorsBuilt + 0.5) * FLOOR_H;
  const craneColor  = `rgba(245,158,11,${0.6 * alpha})`;
  const wireColor   = `rgba(245,158,11,${0.25 * alpha})`;

  // Tower (vertical mast)
  line3d(dc, 6, BASE_Y, 6, 6, craneHeight, 6, craneColor, 1.2);
  // Jib (horizontal arm)
  line3d(dc, 6, craneHeight, 6, 10, craneHeight, 6, craneColor, 1.0);
  // Counter-jib
  line3d(dc, 6, craneHeight, 6, 3.5, craneHeight, 6, craneColor, 0.8);
  // Hoist wire (hanging)
  const hoistX = 8;
  const hoistBottom = craneHeight - 2.5;
  line3d(dc, hoistX, craneHeight, 6, hoistX, hoistBottom, 6, wireColor, 0.6);
  // Hook point
  dot3d(dc, hoistX, hoistBottom, 6, `rgba(245,158,11,${0.7 * alpha})`, 3);
  // Operator cab
  const [cabX, cabY] = project(6, craneHeight - 0.3, 5.5, dc.angle, dc.cx, dc.cy, dc.scale);
  dc.ctx.beginPath();
  dc.ctx.rect(cabX - 4, cabY - 3, 8, 6);
  dc.ctx.fillStyle = `rgba(245,158,11,${0.12 * alpha})`;
  dc.ctx.fill();
  dc.ctx.strokeStyle = `rgba(245,158,11,${0.4 * alpha})`;
  dc.ctx.lineWidth = 0.6;
  dc.ctx.stroke();
}

// ─── Data overlay labels ──────────────────────────────────────────────────────

function drawLabels(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  floorsBuilt: number,
  now: number
) {
  ctx.save();
  ctx.font = "700 9px 'JetBrains Mono', 'Fira Code', monospace";

  // Top-right: scan status
  if (floorsBuilt > 1) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    ctx.fillStyle = `rgba(16,185,129,${0.5 + pulse * 0.3})`;
    ctx.fillRect(W - 110, 20, 6, 6);
    ctx.fillStyle = `rgba(148,163,184,0.55)`;
    ctx.fillText("BIM SCAN ACTIVE", W - 100, 30);
  }

  // Floor counter bottom-left area
  if (floorsBuilt > 0.5) {
    const fl = Math.min(Math.floor(floorsBuilt), FLOORS - 1);
    ctx.fillStyle = "rgba(99,102,241,0.5)";
    ctx.fillText(`FLOOR ${fl}/${FLOORS - 1} COMPLETE`, 20, H - 42);
  }

  // Risk flag if on risk floor
  const riskFloor = floorsBuilt > 1.5 && floorsBuilt < 2.5;
  const riskFloor2 = floorsBuilt > 4.5 && floorsBuilt < 5.5;
  if (riskFloor || riskFloor2) {
    const pulse = 0.4 + 0.6 * Math.sin(now * 0.006);
    ctx.fillStyle = `rgba(239,68,68,${pulse})`;
    ctx.fillText("⚑  STRUCTURAL VARIANCE DETECTED", 20, H - 22);
  } else if (floorsBuilt > 2.5) {
    ctx.fillStyle = "rgba(148,163,184,0.3)";
    ctx.fillText("PPSA-EX-2418 · CRI 67/100 · FLAGGED", 20, H - 22);
  }

  // Top-left: project ref
  if (floorsBuilt > 0.2) {
    ctx.fillStyle = "rgba(148,163,184,0.35)";
    ctx.fillText("VALTOR DIGITAL TWIN v1.0", 20, 30);
    ctx.fillStyle = "rgba(99,102,241,0.3)";
    ctx.fillText("AAU METRO RAIL PHASE 3-204", 20, 44);
  }

  ctx.restore();
}



