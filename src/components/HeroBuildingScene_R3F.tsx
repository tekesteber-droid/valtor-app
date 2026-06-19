/**
 * HeroBuildingScene_R3F.tsx  — React Three Fiber version
 * ─────────────────────────────────────────────────────────────────────────────
 * A lit, GPU-rendered 3D isometric construction scene using Three.js via R3F.
 *
 * INSTALL (one time):
 *   npm install three @react-three/fiber @react-three/drei
 *
 * This produces a sharper, physically-lit result vs the Canvas 2D version.
 * The tradeoff is ~600KB additional bundle (three + fiber).
 * Use this version if you want real shadows, ambient occlusion, and bloom.
 *
 * For zero-dependency version, use HeroBuildingScene.tsx instead.
 */

import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrthographicCamera,
  Environment,
  Float,
  MeshWireframe,
} from "@react-three/drei";
import * as THREE from "three";

// ─── Color palette (matches Valtor brand) ────────────────────────────────────
const INDIGO   = new THREE.Color("#6366f1");
const SLATE    = new THREE.Color("#1e293b");
const RISK_RED = new THREE.Color("#ef4444");
const AMBER    = new THREE.Color("#f59e0b");
const WHITE    = new THREE.Color("#e2e8f0");

// ─── Single floor plate + column grid ────────────────────────────────────────
function Floor({
  level,
  isRisk,
  built,
}: {
  level: number;
  isRisk: boolean;
  built: number;
}) {
  const y      = level * 1.4;
  const cols   = [0, 2, 4, 6];
  const rows   = [0, 2, 4, 6];
  const alpha  = Math.min(Math.max(built - level, 0), 1);
  const colMat = isRisk ? RISK_RED : INDIGO;

  const columnPositions = useMemo(
    () =>
      cols.flatMap((cx) =>
        rows.map((cz) => [cx - 3, y - 0.7, cz - 3] as [number, number, number])
      ),
    [y]
  );

  if (alpha <= 0) return null;

  return (
    <group position={[0, y * alpha, 0]} scale={[1, alpha, 1]}>
      {/* Slab */}
      <mesh receiveShadow castShadow position={[0, 0, 0]}>
        <boxGeometry args={[6.2, 0.08, 6.2]} />
        <meshStandardMaterial
          color={SLATE}
          transparent
          opacity={0.65 * alpha}
          metalness={0.4}
          roughness={0.6}
          wireframe={false}
        />
      </mesh>

      {/* Slab wireframe edge */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[6.2, 0.08, 6.2]} />
        <meshBasicMaterial
          color={isRisk ? RISK_RED : INDIGO}
          transparent
          opacity={0.4 * alpha}
          wireframe
        />
      </mesh>

      {/* Columns */}
      {columnPositions.map(([cx, cy, cz], i) => (
        <mesh
          key={i}
          position={[cx, -0.65, cz]}
          castShadow
        >
          <boxGeometry args={[0.12, 1.3, 0.12]} />
          <meshStandardMaterial
            color={colMat}
            transparent
            opacity={0.8 * alpha}
            metalness={0.6}
            roughness={0.3}
          />
        </mesh>
      ))}

      {/* Beam grid at slab level */}
      {cols.slice(0, -1).map((cx) =>
        rows.map((cz) => (
          <mesh
            key={`beam-x-${cx}-${cz}`}
            position={[cx - 2, 0.04, cz - 3]}
          >
            <boxGeometry args={[2, 0.06, 0.06]} />
            <meshStandardMaterial
              color={WHITE}
              transparent
              opacity={0.15 * alpha}
              metalness={0.2}
              roughness={0.8}
            />
          </mesh>
        ))
      )}
    </group>
  );
}

// ─── Crane ────────────────────────────────────────────────────────────────────
function Crane({ built }: { built: number }) {
  const alpha = Math.min(Math.max(built - 4, 0) / 1.5, 1);
  if (alpha <= 0) return null;
  const top = built * 1.4 + 0.5;

  return (
    <group>
      {/* Mast */}
      <mesh position={[3.1, top / 2, 3.1]} castShadow>
        <boxGeometry args={[0.1, top, 0.1]} />
        <meshStandardMaterial color={AMBER} transparent opacity={0.7 * alpha} metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Jib arm */}
      <mesh position={[4.6, top, 3.1]}>
        <boxGeometry args={[3.0, 0.08, 0.08]} />
        <meshStandardMaterial color={AMBER} transparent opacity={0.7 * alpha} metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Counter jib */}
      <mesh position={[2.3, top, 3.1]}>
        <boxGeometry args={[1.6, 0.08, 0.08]} />
        <meshStandardMaterial color={AMBER} transparent opacity={0.5 * alpha} metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Hoist ball */}
      <Float speed={2} rotationIntensity={0} floatIntensity={0.4}>
        <mesh position={[5.1, top - 2.2, 3.1]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial color={AMBER} transparent opacity={0.9 * alpha} emissive={AMBER} emissiveIntensity={0.3} />
        </mesh>
      </Float>
    </group>
  );
}

// ─── Animated scene ───────────────────────────────────────────────────────────
function BuildingScene() {
  const groupRef   = useRef<THREE.Group>(null);
  const builtRef   = useRef(0);
  const { mouse }  = useThree();
  const TOTAL = 7;

  useFrame(({ clock }, delta) => {
    // Build animation
    if (builtRef.current < TOTAL) {
      builtRef.current = Math.min(builtRef.current + delta * 3.5, TOTAL);
    }

    // Slow rotation + mouse tilt
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.12;
      groupRef.current.rotation.x +=
        (mouse.y * 0.04 - groupRef.current.rotation.x) * 0.05;
    }
  });

  const built = builtRef.current;

  return (
    <group ref={groupRef} position={[0, -4.5, 0]}>
      {/* Ground slab */}
      <mesh receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[8, 0.1, 8]} />
        <meshStandardMaterial color={new THREE.Color("#0f172a")} metalness={0.5} roughness={0.7} />
      </mesh>

      {/* Floors */}
      {Array.from({ length: TOTAL }).map((_, i) => (
        <Floor key={i} level={i} isRisk={i === 1 || i === 4} built={built} />
      ))}

      {/* Crane */}
      <Crane built={built} />
    </group>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────
export function HeroBuildingSceneR3F() {
  return (
    <div style={{ width: "100%", height: "100%", background: "transparent" }} aria-hidden="true">
      <Canvas
        shadows
        dpr={[1, 2]}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
      >
        {/* Isometric-style camera */}
        <OrthographicCamera
          makeDefault
          position={[12, 10, 12]}
          zoom={55}
          near={0.1}
          far={200}
        />

        {/* Lighting */}
        <ambientLight intensity={0.3} color="#6366f1" />
        <directionalLight
          position={[8, 15, 8]}
          intensity={1.2}
          color="#ffffff"
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight
          position={[-8, 5, -4]}
          intensity={0.4}
          color="#6366f1"
        />
        <pointLight position={[3, 15, 3]} intensity={0.6} color="#f59e0b" distance={30} />

        <Suspense fallback={null}>
          <BuildingScene />
        </Suspense>
      </Canvas>
    </div>
  );
}

/*
─────────────────────────────────────────────────────────────────────────────
HOW TO USE THIS VERSION IN index.tsx
─────────────────────────────────────────────────────────────────────────────

1. npm install three @react-three/fiber @react-three/drei

2. import { HeroBuildingSceneR3F } from "@/components/HeroBuildingScene_R3F";

3. In the hero section right column:
   <div className="relative hidden lg:block" style={{ height: "560px" }}>
     <HeroBuildingSceneR3F />
   </div>

4. In vite.config.ts, add to manualChunks:
   threejs: ["three", "@react-three/fiber", "@react-three/drei"],

─────────────────────────────────────────────────────────────────────────────
OPTIONAL ENHANCEMENTS (all via @react-three/postprocessing)
─────────────────────────────────────────────────────────────────────────────

npm install @react-three/postprocessing

Then wrap BuildingScene in <EffectComposer>:
  import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

  <EffectComposer>
    <Bloom luminanceThreshold={0.3} intensity={0.6} />
    <Vignette eskil={false} offset={0.3} darkness={0.6} />
  </EffectComposer>

This gives the "Autodesk ACC / digital twin" glow on the wireframe edges.
─────────────────────────────────────────────────────────────────────────────
*/
