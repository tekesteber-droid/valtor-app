// src/components/BimModel3D.tsx — procedural 3D hero scene: the BidSwift AI audit engine.
//
// The story, left to right: a tender document is ingested → a stream of data
// particles carries it into a holographic BIM model → an indigo scan plane
// sweeps up the structure, resolving each floor from wireframe into audited,
// certified geometry (flagging the two floors where the engine found a
// clash/RFI) → the results surface as a live risk readout beside the tower,
// all sitting on a rotating "common data environment" hub. This replaces the
// previous generic tower-and-cranes scene with one that is legible, at a
// glance, as an AI reading a tender and producing a structured audit — not
// just "a building being built."
//
// Reduced-motion safe throughout (Canvas runs frameloop="demand" and freezes
// on a static, half-audited composition).
import { useRef, useMemo, useEffect, type ReactNode, type RefObject, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Html, Environment, ContactShadows } from '@react-three/drei';
import { useReducedMotion, useScroll, useTransform, useMotionValue, useSpring } from 'framer-motion';
import * as THREE from 'three';

// ─── Palette ──────────────────────────────────────────────────────────────────
// Opaque, high-contrast tones so the model reads clearly against a white page.
// Matched to the app's own design tokens (styles.css :root) so the scene never
// looks like a stock asset dropped into the product.
const INK = '#0F172A'; // technical-drawing linework
const STEEL = '#94A3B8'; // columns / core / unresolved structure
const STEEL_LIGHT = '#CBD5E1'; // slabs / roof cap / pedestal
const INDIGO = '#4F46E5'; // brand accent — scan plane, data stream, active markers
const GLASS = '#A5B4FC'; // curtain-wall tint (the one translucent surface)
const SUCCESS = '#15803D'; // audit cleared
const WARNING = '#B45309'; // risk / attention
const DANGER = '#B91C1C'; // clash / hard flag
const WHITE = '#FFFFFF';

// ─── Tower dimensions ────────────────────────────────────────────────────────
const MAX_FLOORS = 10;
const FLOOR_H = 0.58;
const TOWER_W = 2.7;
const TOWER_D = 2.15;
const BASE_Y = -1.6;
const ROOF_Y = BASE_Y + MAX_FLOORS * FLOOR_H;
const SCAN_LAG = 2; // envelope confirmation trails the structural scan by this many floors

// Concrete core: audited first, the way load-bearing scope gets priced first.
const CORE_W = TOWER_W * 0.32;
const CORE_D = TOWER_D * 0.32;
const CORE_LEAD = 1.4; // floors the core stays ahead of the topmost slab
const CORE_FULL_H = MAX_FLOORS * FLOOR_H + 0.4;

// Two floors where the engine surfaces a finding — driven off real indices so
// every marker/annotation that references them stays in lockstep.
const FLAGGED_FLOORS = new Set([3, 7]);
const floorCenterY = (i: number) => BASE_Y + i * FLOOR_H + FLOOR_H / 2;

// ─── Satellite elements: document intake + risk readout ─────────────────────
const DOCUMENT_POS = new THREE.Vector3(-3.55, BASE_Y + 0.03, 1.7);
const DOCUMENT_SIZE: [number, number] = [1.5, 1.9];

const READOUT_ORIGIN = new THREE.Vector3(3.55, BASE_Y, -0.85);
interface ReadoutBarDef {
  dx: number;
  height: number;
  color: string;
}
const READOUT_BARS: ReadoutBarDef[] = [
  { dx: -0.42, height: 1.05, color: WARNING }, // Risk index
  { dx: 0, height: 0.55, color: INDIGO }, // Margin
  { dx: 0.42, height: 1.35, color: SUCCESS }, // Compliance
];
const READOUT_BAR_W = 0.3;
const READOUT_PAD_W = 1.5;
const READOUT_PAD_D = 0.5;

const HUB_RADII = [TOWER_W * 0.95, TOWER_W * 1.35, TOWER_W * 1.7];

// ─── Scene bounds (drives the fit-to-view camera) ────────────────────────────
// A rotation-invariant bound: farthest any point sits from the vertical (Y)
// axis, and the full vertical span. Because the rig only ever spins the scene
// around Y, a sphere built from these two numbers safely contains the whole
// composition at every rotation angle — so FitCamera can guarantee nothing is
// ever clipped, regardless of container aspect ratio.
function computeSceneBounds() {
  const towerRadius = Math.hypot(TOWER_W / 2, TOWER_D / 2);
  const docRadius = Math.hypot(DOCUMENT_POS.x, DOCUMENT_POS.z) + Math.max(...DOCUMENT_SIZE) / 2;
  const readoutRadius = Math.hypot(READOUT_ORIGIN.x, READOUT_ORIGIN.z) + Math.max(READOUT_PAD_W, READOUT_PAD_D) / 2 + 0.3;
  const hubRadius = HUB_RADII[HUB_RADII.length - 1] + 0.2;
  const radiusXZ = Math.max(towerRadius, docRadius, readoutRadius, hubRadius) + 0.25;

  const topY = ROOF_Y + 1.85; // roof cap + spire + beacon apex, with margin
  const bottomY = BASE_Y - 0.1;
  const centerY = (topY + bottomY) / 2;
  const halfHeight = (topY - bottomY) / 2;
  const sphereRadius = Math.hypot(radiusXZ, halfHeight);

  return { centerY, sphereRadius };
}
const SCENE_BOUNDS = computeSceneBounds();

// ─── Tower geometry ──────────────────────────────────────────────────────────

interface TowerBuild {
  root: THREE.Group;
  floorGroups: THREE.Group[];
  glassGroups: THREE.Group[];
  exposedGroups: THREE.Group[];
  core: THREE.Mesh;
  coreEdge: THREE.LineSegments;
  cap: THREE.Mesh;
  capLine: THREE.LineSegments;
  spire: THREE.Mesh;
  beacon: THREE.Mesh;
  scanRing: THREE.LineLoop;
  scanRingOuter: THREE.LineLoop;
  scanPlane: THREE.Mesh;
  flagPulses: THREE.Mesh[];
}

function buildTower(): TowerBuild {
  const root = new THREE.Group();
  const floorGroups: THREE.Group[] = [];
  const glassGroups: THREE.Group[] = [];
  const exposedGroups: THREE.Group[] = [];
  const flagPulses: THREE.Mesh[] = [];

  const structEdgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.85 });
  const accentEdgeMat = new THREE.LineBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.85 });
  const flagEdgeMat = new THREE.LineBasicMaterial({ color: DANGER, transparent: true, opacity: 0.9 });
  const glassEdgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 });

  const slabMat = new THREE.MeshStandardMaterial({ color: STEEL_LIGHT, metalness: 0.15, roughness: 0.65 });
  const coreMat = new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.1, roughness: 0.8 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: GLASS,
    metalness: 0,
    roughness: 0.12,
    transparent: true,
    opacity: 0.42,
    transmission: 0.5,
    thickness: 0.25,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  });
  const colMat = new THREE.MeshStandardMaterial({
    color: STEEL,
    metalness: 0.75,
    roughness: 0.3,
    emissive: new THREE.Color(INDIGO),
    emissiveIntensity: 0.08,
  });

  // Concrete core — a single tall box, scaled per-frame to lead the slabs.
  const coreUnitGeo = new THREE.BoxGeometry(CORE_W, 1, CORE_D);
  const core = new THREE.Mesh(coreUnitGeo, coreMat);
  root.add(core);
  const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(coreUnitGeo), structEdgeMat);
  root.add(coreEdge);

  // Corner columns run the full height, visible from the start (steel skeleton first).
  const colHeight = MAX_FLOORS * FLOOR_H + 0.3;
  const colPositions: Array<[number, number]> = [
    [-TOWER_W / 2, -TOWER_D / 2],
    [-TOWER_W / 2, TOWER_D / 2],
    [TOWER_W / 2, -TOWER_D / 2],
    [TOWER_W / 2, TOWER_D / 2],
  ];
  colPositions.forEach(([cx, cz]) => {
    const geo = new THREE.CylinderGeometry(0.05, 0.05, colHeight, 8);
    const col = new THREE.Mesh(geo, colMat);
    col.position.set(cx, BASE_Y + colHeight / 2, cz);
    root.add(col);
  });

  for (let i = 0; i < MAX_FLOORS; i++) {
    const fg = new THREE.Group();
    const y = floorCenterY(i);
    const flagged = FLAGGED_FLOORS.has(i);

    // Slab
    const slabGeo = new THREE.BoxGeometry(TOWER_W, 0.05, TOWER_D);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(0, y, 0);
    fg.add(slab);
    const slabLine = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), structEdgeMat);
    slabLine.position.copy(slab.position);
    fg.add(slabLine);

    // Glazing — the audited/certified envelope, trailing the structural scan by SCAN_LAG floors.
    const glassGroup = new THREE.Group();
    const glassH = FLOOR_H * 0.82;
    const glassGeo = new THREE.BoxGeometry(TOWER_W - 0.24, glassH, 0.025);
    const sides: Array<[number, number, number, number]> = [
      [0, y, TOWER_D / 2 + 0.015, 0],
      [0, y, -TOWER_D / 2 - 0.015, 0],
      [-TOWER_W / 2 - 0.015, y, 0, Math.PI / 2],
      [TOWER_W / 2 + 0.015, y, 0, Math.PI / 2],
    ];
    sides.forEach(([x, yy, z, rot]) => {
      const mesh = new THREE.Mesh(glassGeo, glassMat);
      mesh.position.set(x, yy, z);
      mesh.rotation.y = rot;
      glassGroup.add(mesh);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(glassGeo), glassEdgeMat);
      edge.position.copy(mesh.position);
      edge.rotation.y = rot;
      glassGroup.add(edge);
    });
    // Status mullion — a BIM grid-line accent, red on the two floors with an open finding.
    const mullionPts = [
      new THREE.Vector3(-(TOWER_W - 0.24) / 2, y, TOWER_D / 2 + 0.02),
      new THREE.Vector3((TOWER_W - 0.24) / 2, y, TOWER_D / 2 + 0.02),
    ];
    glassGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(mullionPts), flagged ? flagEdgeMat : accentEdgeMat),
    );
    glassGroup.visible = false;
    fg.add(glassGroup);
    glassGroups.push(glassGroup);

    // Exposed structure — shown on floors that are scanned but not yet certified/glazed.
    const exposedGroup = new THREE.Group();
    if (i % 2 === 0) {
      const z = -TOWER_D / 2 - 0.01;
      const braceA = [
        new THREE.Vector3(-TOWER_W / 2, y - FLOOR_H / 2, z),
        new THREE.Vector3(TOWER_W / 2, y + FLOOR_H / 2, z),
      ];
      const braceB = [
        new THREE.Vector3(-TOWER_W / 2, y + FLOOR_H / 2, z),
        new THREE.Vector3(TOWER_W / 2, y - FLOOR_H / 2, z),
      ];
      exposedGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(braceA), accentEdgeMat));
      exposedGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(braceB), accentEdgeMat));
    }
    const frontZ = TOWER_D / 2 + 0.01;
    const braceC = [
      new THREE.Vector3(-TOWER_W / 2, y - FLOOR_H / 2, frontZ),
      new THREE.Vector3(TOWER_W / 2, y + FLOOR_H / 2, frontZ),
    ];
    exposedGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(braceC), structEdgeMat));
    exposedGroup.visible = false;
    fg.add(exposedGroup);
    exposedGroups.push(exposedGroup);

    // Finding marker — a small pulsing flag + halo, riding inside this floor's
    // group so it automatically appears/disappears with the floor itself.
    if (flagged) {
      const markerGroup = new THREE.Group();
      const mx = TOWER_W / 2 - 0.12;
      const mz = TOWER_D / 2 + 0.06;
      const dotMat = new THREE.MeshStandardMaterial({ color: WHITE, emissive: new THREE.Color(DANGER), emissiveIntensity: 1.2 });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), dotMat);
      dot.position.set(mx, y + FLOOR_H / 2 + 0.02, mz);
      markerGroup.add(dot);
      flagPulses.push(dot);

      const haloMat = new THREE.LineBasicMaterial({ color: DANGER, transparent: true, opacity: 0.6 });
      const haloPts: THREE.Vector3[] = [];
      for (let a = 0; a <= 24; a++) {
        const t = (a / 24) * Math.PI * 2;
        haloPts.push(new THREE.Vector3(mx + Math.cos(t) * 0.12, dot.position.y + Math.sin(t) * 0.12, mz));
      }
      markerGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(haloPts), haloMat));
      fg.add(markerGroup);
    }

    fg.visible = false;
    root.add(fg);
    floorGroups.push(fg);
  }

  // Roof cap + spire + beacon, revealed once the scan reaches the top.
  const capGeo = new THREE.BoxGeometry(TOWER_W * 0.55, 0.5, TOWER_D * 0.55);
  const capMat = new THREE.MeshStandardMaterial({ color: STEEL_LIGHT, metalness: 0.5, roughness: 0.35 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(0, ROOF_Y + 0.28, 0);
  cap.visible = false;
  root.add(cap);

  const capLine = new THREE.LineSegments(new THREE.EdgesGeometry(capGeo), structEdgeMat);
  capLine.position.copy(cap.position);
  capLine.visible = false;
  root.add(capLine);

  const spireGeo = new THREE.CylinderGeometry(0.008, 0.022, 1.1, 6);
  const spireMat = new THREE.MeshStandardMaterial({ color: INDIGO, emissive: new THREE.Color(INDIGO), emissiveIntensity: 0.8 });
  const spire = new THREE.Mesh(spireGeo, spireMat);
  spire.position.set(0, cap.position.y + 0.25 + 0.55, 0);
  spire.visible = false;
  root.add(spire);

  // Certification beacon — green once the AI has scanned every floor.
  const beaconMat = new THREE.MeshStandardMaterial({ color: WHITE, emissive: new THREE.Color(SUCCESS), emissiveIntensity: 1.4 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), beaconMat);
  beacon.position.set(0, spire.position.y + 0.58, 0);
  beacon.visible = false;
  root.add(beacon);

  // "Scan frontier" — a pulsing indigo double outline plus a translucent
  // laser sheet marking the floor the AI is currently auditing.
  const buildRing = (pad: number) => {
    const hw = TOWER_W / 2 + pad;
    const hd = TOWER_D / 2 + pad;
    const pts = [
      new THREE.Vector3(-hw, 0, -hd),
      new THREE.Vector3(hw, 0, -hd),
      new THREE.Vector3(hw, 0, hd),
      new THREE.Vector3(-hw, 0, hd),
    ];
    const mat = new THREE.LineBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.7 });
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    ring.visible = false;
    root.add(ring);
    return ring;
  };
  const scanRing = buildRing(0.06);
  const scanRingOuter = buildRing(0.16);

  const scanPlaneGeo = new THREE.PlaneGeometry(TOWER_W + 0.6, TOWER_D + 0.6);
  const scanPlaneMat = new THREE.MeshBasicMaterial({
    color: INDIGO,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const scanPlane = new THREE.Mesh(scanPlaneGeo, scanPlaneMat);
  scanPlane.rotation.x = -Math.PI / 2;
  scanPlane.visible = false;
  root.add(scanPlane);

  return {
    root,
    floorGroups,
    glassGroups,
    exposedGroups,
    core,
    coreEdge,
    cap,
    capLine,
    spire,
    beacon,
    scanRing,
    scanRingOuter,
    scanPlane,
    flagPulses,
  };
}

function BimModel({ progressRef, reduced }: { progressRef: MutableRefObject<number>; reduced: boolean }) {
  const build = useMemo(() => buildTower(), []);
  const shown = useRef(0);
  const completeShown = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  // `complete` forces full glazing on the top floors once the roof caps —
  // otherwise the last SCAN_LAG floors would stay permanently exposed.
  const applyFloorState = (floorsToShow: number, complete: boolean) => {
    build.floorGroups.forEach((g, i) => { g.visible = i < floorsToShow; });
    build.glassGroups.forEach((g, i) => { g.visible = complete || i < floorsToShow - SCAN_LAG; });
    build.exposedGroups.forEach((g, i) => {
      g.visible = !complete && i < floorsToShow && i >= floorsToShow - SCAN_LAG;
    });

    const leadFloors = floorsToShow + CORE_LEAD;
    const coreH = Math.min(CORE_FULL_H, leadFloors * FLOOR_H);
    build.core.scale.y = coreH;
    build.core.position.y = BASE_Y + coreH / 2;
    build.coreEdge.scale.y = coreH;
    build.coreEdge.position.y = BASE_Y + coreH / 2;
  };

  // Reduced motion: apply a fixed, half-audited state once and never touch it again.
  // Canvas runs frameloop="demand" in this mode, so a manual mutation like this
  // needs an explicit invalidate() to actually reach the screen.
  useEffect(() => {
    if (!reduced) return;
    const floorsToShow = Math.max(1, Math.min(MAX_FLOORS, Math.ceil(progressRef.current * MAX_FLOORS)));
    applyFloorState(floorsToShow, false);
    build.cap.visible = false;
    build.capLine.visible = false;
    build.spire.visible = false;
    build.beacon.visible = false;
    build.scanRing.visible = false;
    build.scanRingOuter.visible = false;
    build.scanPlane.visible = false;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, build, progressRef, invalidate]);

  useFrame(({ clock }) => {
    if (reduced) return;
    const p = progressRef.current;
    const floorsToShow = Math.max(1, Math.min(MAX_FLOORS, Math.ceil(p * MAX_FLOORS)));
    const complete = p >= 0.995;

    if (floorsToShow !== shown.current || complete !== completeShown.current) {
      applyFloorState(floorsToShow, complete);
      shown.current = floorsToShow;
      completeShown.current = complete;
    }

    build.cap.visible = complete;
    build.capLine.visible = complete;
    build.spire.visible = complete;
    build.beacon.visible = complete;
    if (complete) {
      const beaconMat = build.beacon.material as THREE.MeshStandardMaterial;
      beaconMat.emissiveIntensity = 1.0 + Math.max(0, Math.sin(clock.elapsedTime * 2.4)) * 1.6;
    }

    if (!complete && floorsToShow < MAX_FLOORS) {
      const pulse = 0.4 + Math.sin(clock.elapsedTime * 3.2) * 0.3;
      const scanY = BASE_Y + floorsToShow * FLOOR_H;
      build.scanRing.visible = true;
      build.scanRingOuter.visible = true;
      build.scanPlane.visible = true;
      build.scanRing.position.y = scanY;
      build.scanRingOuter.position.y = scanY;
      build.scanPlane.position.y = scanY;
      (build.scanRing.material as THREE.LineBasicMaterial).opacity = pulse + 0.25;
      (build.scanRingOuter.material as THREE.LineBasicMaterial).opacity = Math.max(0, pulse - 0.15);
      (build.scanPlane.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.max(0, pulse) * 0.1;
    } else {
      build.scanRing.visible = false;
      build.scanRingOuter.visible = false;
      build.scanPlane.visible = false;
    }

    // Findings pulse steadily regardless of scan position, so a flagged floor
    // keeps reading as "open" even once the scan has moved past it.
    build.flagPulses.forEach((dot, i) => {
      const mat = dot.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.max(0, Math.sin(clock.elapsedTime * 2.6 + i * 1.1)) * 1.1;
    });
  });

  return <primitive object={build.root} />;
}

// ─── Envelope hologram ────────────────────────────────────────────────────────
// A faint, always-visible wireframe of the full building — the tender's known
// scope — that the scan gradually resolves into certified structure above.

function buildEnvelope(): THREE.Group {
  const group = new THREE.Group();
  const fullH = MAX_FLOORS * FLOOR_H;

  const outlineGeo = new THREE.BoxGeometry(TOWER_W, fullH, TOWER_D);
  const outlineMat = new THREE.LineBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.16 });
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineGeo), outlineMat);
  outline.position.set(0, BASE_Y + fullH / 2, 0);
  group.add(outline);

  const tickMat = new THREE.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.1 });
  for (let i = 1; i < MAX_FLOORS; i++) {
    const y = BASE_Y + i * FLOOR_H;
    const pts = [
      new THREE.Vector3(-TOWER_W / 2, y, -TOWER_D / 2),
      new THREE.Vector3(TOWER_W / 2, y, -TOWER_D / 2),
      new THREE.Vector3(TOWER_W / 2, y, TOWER_D / 2),
      new THREE.Vector3(-TOWER_W / 2, y, TOWER_D / 2),
      new THREE.Vector3(-TOWER_W / 2, y, -TOWER_D / 2),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), tickMat));
  }
  return group;
}

function EnvelopeGhost() {
  const group = useMemo(() => buildEnvelope(), []);
  return <primitive object={group} />;
}

// ─── Tender document intake ──────────────────────────────────────────────────

function buildDocumentTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 648;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(15,23,42,0.16)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(24, 24, w - 48, 56);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('TENDER — RFP 2291', 40, 60);

  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.font = '15px monospace';
  ctx.fillText('SCOPE: STRUCTURAL + MEP', 40, 108);
  ctx.fillText('CLOSING: 14 DAYS', 40, 130);

  ctx.fillStyle = 'rgba(15,23,42,0.18)';
  for (let i = 0; i < 8; i++) {
    const y = 168 + i * 20;
    const lineW = i % 3 === 2 ? w * 0.38 : w * 0.72;
    ctx.fillRect(40, y, lineW, 8);
  }

  const tableY = 372;
  const tableH = 168;
  ctx.strokeStyle = 'rgba(15,23,42,0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, tableY, w - 80, tableH);
  for (let r = 1; r < 5; r++) {
    ctx.beginPath();
    ctx.moveTo(40, tableY + (tableH / 5) * r);
    ctx.lineTo(w - 40, tableY + (tableH / 5) * r);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(w * 0.58, tableY);
  ctx.lineTo(w * 0.58, tableY + tableH);
  ctx.stroke();

  ctx.strokeStyle = '#B91C1C';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w - 108, h - 108, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#B91C1C';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('AI', w - 108, h - 116);
  ctx.fillText('AUDIT', w - 108, h - 100);
  ctx.fillText('FLAG', w - 108, h - 84);
  ctx.textAlign = 'left';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildDocument(): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const [w, h] = DOCUMENT_SIZE;

  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshStandardMaterial({
    map: buildDocumentTexture(),
    emissive: new THREE.Color(INDIGO),
    emissiveIntensity: 0.15,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.35 }),
  );
  group.add(edge);

  group.position.copy(DOCUMENT_POS);
  group.rotation.set(-Math.PI / 2.6, 0.18, 0);
  return { group, mat };
}

function TenderDocument() {
  const built = useMemo(() => buildDocument(), []);
  useFrame(({ clock }) => {
    built.mat.emissiveIntensity = 0.12 + Math.max(0, Math.sin(clock.elapsedTime * 1.6)) * 0.22;
  });
  return <primitive object={built.group} />;
}

// ─── Risk readout ─────────────────────────────────────────────────────────────

function buildReadout(): { group: THREE.Group; bars: THREE.Mesh[] } {
  const group = new THREE.Group();

  const baseGeo = new THREE.BoxGeometry(READOUT_PAD_W, 0.04, READOUT_PAD_D);
  const baseMat = new THREE.MeshStandardMaterial({ color: STEEL_LIGHT, metalness: 0.4, roughness: 0.4 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.02, 0);
  group.add(base);
  const baseEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(baseGeo),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 }),
  );
  baseEdge.position.copy(base.position);
  group.add(baseEdge);

  const bars: THREE.Mesh[] = [];
  READOUT_BARS.forEach((b) => {
    const geo = new THREE.BoxGeometry(READOUT_BAR_W, b.height, READOUT_BAR_W);
    const mat = new THREE.MeshStandardMaterial({
      color: b.color,
      metalness: 0.15,
      roughness: 0.4,
      emissive: new THREE.Color(b.color),
      emissiveIntensity: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.dx, 0.04 + b.height / 2, 0);
    mesh.userData.baseY = mesh.position.y;
    group.add(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }),
    );
    edge.position.copy(mesh.position);
    group.add(edge);
    bars.push(mesh);
  });

  group.position.copy(READOUT_ORIGIN);
  return { group, bars };
}

function RiskReadout({ reduced }: { reduced: boolean }) {
  const built = useMemo(() => buildReadout(), []);
  useFrame(({ clock }) => {
    if (reduced) return;
    built.bars.forEach((bar, i) => {
      const baseY = bar.userData.baseY as number;
      bar.position.y = baseY + Math.sin(clock.elapsedTime * 1.1 + i * 1.3) * 0.025;
    });
  });
  return <primitive object={built.group} />;
}

// ─── Common data environment hub ──────────────────────────────────────────────
// A dashed turntable beneath the tower — the shared model/data layer every
// audit reads from and writes back to.

function buildDashedRing(radius: number, color: string, opacity: number, dashSize: number, gapSize: number): THREE.LineLoop {
  const segments = 128;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize, gapSize });
  const loop = new THREE.LineLoop(geo, mat);
  loop.computeLineDistances();
  return loop;
}

function DataHubRing({ reduced }: { reduced: boolean }) {
  const built = useMemo(() => {
    const group = new THREE.Group();
    const r1 = buildDashedRing(HUB_RADII[0], INDIGO, 0.35, 0.14, 0.1);
    const r2 = buildDashedRing(HUB_RADII[1], STEEL, 0.22, 0.06, 0.16);
    const r3 = buildDashedRing(HUB_RADII[2], WARNING, 0.14, 0.03, 0.22);
    r1.position.y = BASE_Y - 0.03;
    r2.position.y = BASE_Y - 0.035;
    r3.position.y = BASE_Y - 0.04;
    group.add(r1, r2, r3);
    return { group, r1, r2, r3 };
  }, []);

  useFrame((_, delta) => {
    if (reduced) return;
    built.r1.rotation.y += delta * 0.07;
    built.r2.rotation.y -= delta * 0.045;
    built.r3.rotation.y += delta * 0.028;
  });

  return <primitive object={built.group} />;
}

// ─── Blueprint ground grid ────────────────────────────────────────────────────

function buildGroundGrid(): THREE.Group {
  const group = new THREE.Group();
  const y = BASE_Y - 0.02;

  const fine = new THREE.GridHelper(30, 60, INK, INK);
  const fineMat = fine.material as THREE.LineBasicMaterial;
  fineMat.transparent = true;
  fineMat.opacity = 0.06;
  fine.position.y = y;
  group.add(fine);

  const bold = new THREE.GridHelper(30, 15, INDIGO, INDIGO);
  const boldMat = bold.material as THREE.LineBasicMaterial;
  boldMat.transparent = true;
  boldMat.opacity = 0.2;
  bold.position.y = y + 0.002;
  group.add(bold);

  // Site / plot boundary
  const boundaryGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TOWER_W + 2.6, 0.001, TOWER_D + 2.6));
  const boundaryMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 });
  const boundary = new THREE.LineSegments(boundaryGeo, boundaryMat);
  boundary.position.y = y + 0.004;
  group.add(boundary);

  // Building footprint, called out in indigo — a BIM plan-view accent.
  const footprintGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TOWER_W + 0.1, 0.001, TOWER_D + 0.1));
  const footprintMat = new THREE.LineBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.55 });
  const footprint = new THREE.LineSegments(footprintGeo, footprintMat);
  footprint.position.y = y + 0.006;
  group.add(footprint);

  return group;
}

function GroundGrid() {
  const group = useMemo(() => buildGroundGrid(), []);
  return <primitive object={group} />;
}

// Soft radial glow beneath the tower — a lighting cue, not a clipping mask.
function buildGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(79, 70, 229, 0.28)');
  gradient.addColorStop(0.6, 'rgba(79, 70, 229, 0.08)');
  gradient.addColorStop(1, 'rgba(79, 70, 229, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function GroundGlow() {
  const texture = useMemo(() => buildGlowTexture(), []);
  return (
    <mesh position={[0, BASE_Y - 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[9, 9]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

// ─── Floating data particles ───────────────────────────────────────────────────
// Two pools sharing one buffer: an ambient dust field, and a smaller "ingest
// stream" that arcs from the tender document into the tower — the visible
// thread tying the document to the model it becomes.

const AMBIENT_COUNT = 100;
const STREAM_COUNT = 36;
const PARTICLE_COUNT = AMBIENT_COUNT + STREAM_COUNT;
const STREAM_TARGET = new THREE.Vector3(0, BASE_Y + 1.1, 0);

function Particles({ reduced }: { reduced: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, colors, ambientSpeeds, streamT, streamSpeed, streamJitter } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const ambientSpeeds = new Float32Array(AMBIENT_COUNT);
    const streamT = new Float32Array(STREAM_COUNT);
    const streamSpeed = new Float32Array(STREAM_COUNT);
    const streamJitter = new Float32Array(STREAM_COUNT * 2);

    const ambientPalette = [new THREE.Color(INDIGO), new THREE.Color(INK), new THREE.Color(WHITE)];
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 13;
      positions[i * 3 + 1] = Math.random() * 8 - 2.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 13;
      ambientSpeeds[i] = 0.12 + Math.random() * 0.22;
      const c = ambientPalette[i % ambientPalette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const streamColor = new THREE.Color(INDIGO);
    for (let s = 0; s < STREAM_COUNT; s++) {
      const idx = AMBIENT_COUNT + s;
      streamT[s] = Math.random();
      streamSpeed[s] = 0.35 + Math.random() * 0.35;
      streamJitter[s * 2] = (Math.random() - 0.5) * 0.5;
      streamJitter[s * 2 + 1] = (Math.random() - 0.5) * 0.5;
      positions[idx * 3] = DOCUMENT_POS.x;
      positions[idx * 3 + 1] = DOCUMENT_POS.y;
      positions[idx * 3 + 2] = DOCUMENT_POS.z;
      colors[idx * 3] = streamColor.r;
      colors[idx * 3 + 1] = streamColor.g;
      colors[idx * 3 + 2] = streamColor.b;
    }

    return { positions, colors, ambientSpeeds, streamT, streamSpeed, streamJitter };
  }, []);

  useFrame((_, delta) => {
    if (reduced) return;
    const geo = pointsRef.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      let py = pos.getY(i) + ambientSpeeds[i] * delta;
      if (py > 6) py = -2.2;
      pos.setY(i, py);
    }

    for (let s = 0; s < STREAM_COUNT; s++) {
      const idx = AMBIENT_COUNT + s;
      let t = streamT[s] + streamSpeed[s] * delta;
      if (t >= 1) t -= 1;
      streamT[s] = t;

      const jx = streamJitter[s * 2];
      const jz = streamJitter[s * 2 + 1];
      const arc = Math.sin(t * Math.PI) * 0.9;

      pos.setX(idx, THREE.MathUtils.lerp(DOCUMENT_POS.x, STREAM_TARGET.x, t) + jx * (1 - t));
      pos.setY(idx, THREE.MathUtils.lerp(DOCUMENT_POS.y, STREAM_TARGET.y, t) + arc);
      pos.setZ(idx, THREE.MathUtils.lerp(DOCUMENT_POS.z, STREAM_TARGET.z, t) + jz * (1 - t));
    }

    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        vertexColors
        transparent
        opacity={0.65}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Annotations ──────────────────────────────────────────────────────────────

interface AnnotationDef {
  label: string;
  pos: [number, number, number];
  flag?: boolean;
  pulse?: boolean;
  minProgress: number;
}

const ANNOTATIONS: AnnotationDef[] = [
  { label: 'TENDER DOC — INGESTED', pos: [DOCUMENT_POS.x + 0.95, DOCUMENT_POS.y + 0.95, DOCUMENT_POS.z], minProgress: 0 },
  { label: 'BOQ EXTRACTED · 1,204 ITEMS', pos: [DOCUMENT_POS.x + 0.35, DOCUMENT_POS.y + 1.55, DOCUMENT_POS.z - 0.55], minProgress: 0.08 },
  { label: 'GRID REF C/4', pos: [1.7, -1.3, 2.4], minProgress: 0 },
  {
    label: 'CLASH DETECTED ×2',
    pos: [TOWER_W / 2 + 0.35, floorCenterY(3) + 0.2, TOWER_D / 2 + 0.35],
    flag: true,
    minProgress: 0.42,
  },
  {
    label: 'RFI-0231 OPEN',
    pos: [TOWER_W / 2 + 0.35, floorCenterY(7) + 0.2, TOWER_D / 2 + 0.25],
    flag: true,
    minProgress: 0.82,
  },
  { label: 'RISK INDEX 67%', pos: [READOUT_ORIGIN.x - 0.42, READOUT_ORIGIN.y + 1.3, READOUT_ORIGIN.z], pulse: true, minProgress: 0.15 },
  { label: 'MARGIN 15.2%', pos: [READOUT_ORIGIN.x, READOUT_ORIGIN.y + 0.78, READOUT_ORIGIN.z], pulse: true, minProgress: 0.15 },
  { label: 'COMPLIANCE 92%', pos: [READOUT_ORIGIN.x + 0.42, READOUT_ORIGIN.y + 1.6, READOUT_ORIGIN.z], pulse: true, minProgress: 0.15 },
  { label: 'GO / NO-GO: CONDITIONAL', pos: [0, ROOF_Y + 1.15, 0], minProgress: 0.97 },
];

function Annotations({ progressRef, reduced }: { progressRef: MutableRefObject<number>; reduced: boolean }) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!reduced) return;
    const p = progressRef.current;
    ANNOTATIONS.forEach((a, i) => {
      const el = refs.current[i];
      if (!el) return;
      const visible = p >= a.minProgress;
      el.style.opacity = visible ? '1' : '0';
      el.style.transform = visible ? 'translateY(0)' : 'translateY(6px)';
    });
    // Html labels are plain DOM, not part of the WebGL scene graph, so they don't
    // strictly need a render — but harmless to keep the canvas in sync too.
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, progressRef, invalidate]);

  useFrame(() => {
    if (reduced) return;
    const p = progressRef.current;
    ANNOTATIONS.forEach((a, i) => {
      const el = refs.current[i];
      if (!el) return;
      const visible = p >= a.minProgress;
      const target = visible ? '1' : '0';
      if (el.style.opacity !== target) {
        el.style.opacity = target;
        el.style.transform = visible ? 'translateY(0)' : 'translateY(6px)';
      }
    });
  });

  return (
    <>
      {ANNOTATIONS.map((a, i) => (
        <Html key={a.label} position={a.pos} center>
          <div
            ref={(el) => { refs.current[i] = el; }}
            className={`annotation-badge ${a.flag ? 'flag' : ''} ${a.pulse ? 'pulse' : ''}`}
            style={{ opacity: 0, transform: 'translateY(6px)', transition: 'opacity 0.5s ease, transform 0.5s ease' }}
          >
            {a.flag && <span className="dot" />}
            {a.label}
          </div>
        </Html>
      ))}
    </>
  );
}

// ─── FitCamera: keeps the whole composition inside the frustum ──────────────────
//
// Instead of a fixed FOV + position (which clips content on many container
// aspect ratios), this dollies the camera in/out along a fixed viewing
// direction so the scene's bounding sphere always exactly fits the current
// container's width AND height, at a constant, non-fisheye field of view.

const CAMERA_FOV = 26; // vertical degrees, kept constant — only distance changes
const CAMERA_DIR = new THREE.Vector3(0.42, 0.34, 0.84).normalize();
const FIT_MARGIN = 1.12; // headroom so nothing touches the canvas edge

function FitCamera() {
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const size = useThree((s) => s.size);

  useFrame(() => {
    const cam = camRef.current;
    if (!cam) return;
    const aspect = size.width / Math.max(1, size.height);
    const thetaV = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
    const distV = (SCENE_BOUNDS.sphereRadius * FIT_MARGIN) / Math.sin(thetaV);
    const thetaH = Math.atan(Math.tan(thetaV) * aspect);
    const distH = (SCENE_BOUNDS.sphereRadius * FIT_MARGIN) / Math.sin(thetaH);
    const dist = Math.max(distV, distH);

    const center = new THREE.Vector3(0, SCENE_BOUNDS.centerY, 0);
    cam.position.copy(center).addScaledVector(CAMERA_DIR, dist);
    if (cam.fov !== CAMERA_FOV) cam.fov = CAMERA_FOV;
    cam.near = Math.max(0.1, dist - SCENE_BOUNDS.sphereRadius * 2);
    cam.far = dist + SCENE_BOUNDS.sphereRadius * 3;
    cam.lookAt(center);
    cam.updateProjectionMatrix();
  });

  const initialDist = (SCENE_BOUNDS.sphereRadius * FIT_MARGIN) / Math.sin(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const initialPos: [number, number, number] = [
    CAMERA_DIR.x * initialDist,
    SCENE_BOUNDS.centerY + CAMERA_DIR.y * initialDist,
    CAMERA_DIR.z * initialDist,
  ];

  return <PerspectiveCamera ref={camRef} makeDefault position={initialPos} fov={CAMERA_FOV} />;
}

// ─── Rig: auto-rotation + spring-damped mouse tilt + scroll parallax ─────────────

function Rig({
  children,
  reduced,
  containerRef,
  progressRef,
}: {
  children: ReactNode;
  reduced: boolean;
  containerRef: RefObject<HTMLDivElement>;
  progressRef: MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const spin = useRef(0);

  const mvX = useMotionValue(0);
  const mvY = useMotionValue(0);
  const springX = useSpring(mvX, { stiffness: 55, damping: 14, mass: 0.7 });
  const springY = useSpring(mvY, { stiffness: 55, damping: 14, mass: 0.7 });

  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start end', 'end start'] });
  const scrollRotateZ = useTransform(scrollYProgress, [0, 1], [-4, 4]);
  const scrollParallaxY = useTransform(scrollYProgress, [0, 1], [0.3, -0.3]);
  const scrollProgress = useTransform(scrollYProgress, [0.05, 0.65], [0, 1]);

  useEffect(() => {
    if (reduced) return;
    const el = containerRef.current;
    if (!el) return;
    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      mvX.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
      mvY.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const handleLeave = () => {
      mvX.set(0);
      mvY.set(0);
    };
    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [reduced, containerRef, mvX, mvY]);

  useFrame((_, delta) => {
    if (reduced) {
      progressRef.current = 0.5;
      return;
    }
    spin.current += delta * 4; // slow ambient auto-rotation, degrees/sec
    if (groupRef.current) {
      const tiltX = springX.get() * 5;
      const tiltY = springY.get() * -7;
      groupRef.current.rotation.x = THREE.MathUtils.degToRad(tiltX);
      groupRef.current.rotation.y = THREE.MathUtils.degToRad(tiltY + spin.current);
      groupRef.current.rotation.z = THREE.MathUtils.degToRad(scrollRotateZ.get());
      groupRef.current.position.y = scrollParallaxY.get();
    }
    progressRef.current = Math.min(1, Math.max(0.03, scrollProgress.get()));
  });

  return <group ref={groupRef}>{children}</group>;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({ reduced, containerRef, progressRef }: {
  reduced: boolean;
  containerRef: RefObject<HTMLDivElement>;
  progressRef: MutableRefObject<number>;
}) {
  return (
    <>
      <FitCamera />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 4]} intensity={1.5} color={WHITE} />
      <directionalLight position={[-6, 4, -5]} intensity={0.5} color={GLASS} />
      <Environment preset="city" />

      <Rig reduced={reduced} containerRef={containerRef} progressRef={progressRef}>
        <EnvelopeGhost />
        <BimModel progressRef={progressRef} reduced={reduced} />
        <TenderDocument />
        <RiskReadout reduced={reduced} />
        <DataHubRing reduced={reduced} />
        <GroundGrid />
        <GroundGlow />
        <Particles reduced={reduced} />
        <Annotations progressRef={progressRef} reduced={reduced} />
      </Rig>

      <ContactShadows
        position={[0, BASE_Y - 0.02, 0]}
        opacity={0.45}
        scale={18}
        blur={2.4}
        far={5}
        color="#0F172A"
        frames={reduced ? 1 : Infinity}
      />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BimModel3D() {
  const reducedMotion = useReducedMotion();
  const reduced = !!reducedMotion;
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(reduced ? 0.5 : 0.02);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[500px] select-none" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={reduced ? 'demand' : 'always'}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <Scene reduced={reduced} containerRef={containerRef} progressRef={progressRef} />
      </Canvas>
    </div>
  );
}