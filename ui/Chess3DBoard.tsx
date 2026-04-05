"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Piece encoding from the existing game logic
const isW = (p: number) => p > 0 && p % 2 === 0;
const pt = (p: number) => p & 0xfe;

interface Chess3DProps {
  board: number[];
  selected: number | null;
  validMoves: number[];
  lastMove: { f: number; t: number } | null;
  check: boolean;
  phase: "ready" | "playing" | "gameover";
  onClick: (idx: number) => void;
  autoRotate?: boolean;
}

const SQUARE_SIZE = 1;
const BOARD_OFFSET = -3.5;
const MAGIC_PURPLE = 0x9945ff;
const NEON_CYAN = 0x00f0ff;

// Convert board index (0-63) to world position
function idxToWorld(idx: number): THREE.Vector3 {
  const rank = idx >> 3; // 0=rank1, 7=rank8
  const file = idx & 7;  // 0=a, 7=h
  return new THREE.Vector3(
    file + BOARD_OFFSET + 0.5,
    0.12,
    (7 - rank) + BOARD_OFFSET + 0.5
  );
}

// LatheGeometry from profile points
function createLatheProfile(points: [number, number][], segments = 32): THREE.LatheGeometry {
  const vectors = points.map(p => new THREE.Vector2(p[0], p[1]));
  return new THREE.LatheGeometry(vectors, segments);
}

// Piece profiles
function getPawnProfile(): [number, number][] {
  return [[0,0],[0.32,0],[0.34,0.03],[0.34,0.08],[0.30,0.12],[0.15,0.18],[0.12,0.30],[0.11,0.50],[0.13,0.55],[0.18,0.58],[0.13,0.61],[0.11,0.65],[0.18,0.72],[0.22,0.80],[0.22,0.88],[0.18,0.94],[0.10,0.98],[0,1.0]];
}
function getRookProfile(): [number, number][] {
  return [[0,0],[0.36,0],[0.38,0.04],[0.38,0.10],[0.32,0.14],[0.16,0.20],[0.14,0.35],[0.13,0.70],[0.15,0.75],[0.22,0.78],[0.26,0.82],[0.28,0.88],[0.28,1.00],[0.30,1.00],[0.30,1.12],[0.24,1.12],[0.24,1.05],[0.18,1.05],[0.18,1.12],[0,1.12]];
}
function getKnightProfile(): [number, number][] {
  return [[0,0],[0.34,0],[0.36,0.04],[0.36,0.10],[0.30,0.14],[0.16,0.20],[0.14,0.35],[0.13,0.55],[0.15,0.60],[0.20,0.63],[0.22,0.68],[0.22,0.72],[0.18,0.75],[0,0.75]];
}
function getBishopProfile(): [number, number][] {
  return [[0,0],[0.34,0],[0.36,0.04],[0.36,0.10],[0.30,0.14],[0.16,0.20],[0.13,0.35],[0.11,0.60],[0.13,0.65],[0.17,0.68],[0.13,0.71],[0.10,0.75],[0.16,0.85],[0.18,0.95],[0.16,1.05],[0.10,1.15],[0.04,1.22],[0,1.25]];
}
function getQueenProfile(): [number, number][] {
  return [[0,0],[0.38,0],[0.40,0.04],[0.40,0.10],[0.34,0.14],[0.18,0.22],[0.15,0.40],[0.13,0.65],[0.15,0.70],[0.20,0.73],[0.15,0.76],[0.12,0.80],[0.18,0.90],[0.24,1.00],[0.22,1.08],[0.26,1.15],[0.20,1.10],[0.24,1.18],[0.15,1.12],[0.08,1.22],[0,1.25]];
}
function getKingProfile(): [number, number][] {
  return [[0,0],[0.40,0],[0.42,0.04],[0.42,0.10],[0.36,0.14],[0.19,0.22],[0.16,0.45],[0.14,0.70],[0.16,0.75],[0.22,0.78],[0.16,0.81],[0.13,0.85],[0.20,0.95],[0.26,1.05],[0.24,1.12],[0.28,1.18],[0.22,1.14],[0.26,1.22],[0.18,1.16],[0.10,1.28],[0.04,1.32],[0,1.35]];
}

// Map piece encoding to type letter
function pieceTypeFromEncoding(p: number): string {
  const t = pt(p);
  switch (t) {
    case 2: return "p";
    case 4: return "r";
    case 6: return "n";
    case 8: return "b";
    case 10: return "q";
    case 12: return "k";
    default: return "";
  }
}

function createPieceMesh(type: string, white: boolean): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: white ? 0xeee8f5 : 0x1a0d2e,
    roughness: white ? 0.2 : 0.25,
    metalness: white ? 0.15 : 0.4,
    emissive: white ? 0x4422cc : 0x6622cc,
    emissiveIntensity: white ? 0.08 : 0.15,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: white ? 0xaaddff : 0xbb66ff,
    roughness: 0.1, metalness: 0.8,
    emissive: white ? NEON_CYAN : MAGIC_PURPLE,
    emissiveIntensity: 0.6,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: white ? NEON_CYAN : MAGIC_PURPLE,
    emissive: white ? NEON_CYAN : MAGIC_PURPLE,
    emissiveIntensity: 1.8,
    transparent: true, opacity: 0.7,
    roughness: 0.05, metalness: 1.0,
  });

  const scale = 1.15;

  switch (type) {
    case "p": {
      const body = new THREE.Mesh(createLatheProfile(getPawnProfile(), 24), bodyMat);
      body.scale.set(scale, scale, scale);
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      break;
    }
    case "r": {
      const body = new THREE.Mesh(createLatheProfile(getRookProfile(), 4), bodyMat);
      body.scale.set(scale, scale, scale);
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      break;
    }
    case "n": {
      const base = new THREE.Mesh(createLatheProfile(getKnightProfile(), 24), bodyMat);
      base.scale.set(scale, scale, scale);
      base.castShadow = true; base.receiveShadow = true;
      group.add(base);
      const headGroup = new THREE.Group();
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.35), bodyMat);
      head.position.set(0.05, 0.22, 0); head.rotation.z = 0.3; head.castShadow = true;
      headGroup.add(head);
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.28), bodyMat);
      snout.position.set(0.18, 0.08, 0); snout.rotation.z = 0.5; snout.castShadow = true;
      headGroup.add(snout);
      const earGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
      const ear1 = new THREE.Mesh(earGeo, bodyMat);
      ear1.position.set(-0.02, 0.48, 0.08); ear1.rotation.z = -0.2;
      headGroup.add(ear1);
      const ear2 = ear1.clone(); ear2.position.z = -0.08;
      headGroup.add(ear2);
      const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.15), accentMat);
      mane.position.set(-0.10, 0.25, 0); mane.rotation.z = 0.15;
      headGroup.add(mane);
      headGroup.position.y = 0.75 * scale;
      headGroup.scale.set(scale, scale, scale);
      group.add(headGroup);
      break;
    }
    case "b": {
      const body = new THREE.Mesh(createLatheProfile(getBishopProfile(), 24), bodyMat);
      body.scale.set(scale, scale, scale);
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.04), glowMat);
      slit.position.set(0, 1.05 * scale, 0.14 * scale);
      slit.rotation.z = Math.PI / 6;
      group.add(slit);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 16, 16), accentMat);
      ball.position.y = 1.28 * scale;
      group.add(ball);
      break;
    }
    case "q": {
      const body = new THREE.Mesh(createLatheProfile(getQueenProfile(), 8), bodyMat);
      body.scale.set(scale, scale, scale);
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09 * scale, 24, 24), glowMat);
      orb.position.y = 1.30 * scale;
      group.add(orb);
      for (let i = 0; i < 6; i++) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.04 * scale, 0), glowMat);
        const angle = (i / 6) * Math.PI * 2;
        gem.position.set(Math.cos(angle) * 0.22 * scale, 1.05 * scale, Math.sin(angle) * 0.22 * scale);
        group.add(gem);
      }
      break;
    }
    case "k": {
      const body = new THREE.Mesh(createLatheProfile(getKingProfile(), 8), bodyMat);
      body.scale.set(scale, scale, scale);
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06 * scale, 0.28 * scale, 0.06 * scale), accentMat);
      crossV.position.y = 1.45 * scale; crossV.castShadow = true;
      group.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.20 * scale, 0.06 * scale, 0.06 * scale), accentMat);
      crossH.position.y = 1.50 * scale; crossH.castShadow = true;
      group.add(crossH);
      for (let i = 0; i < 4; i++) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05 * scale, 0), glowMat);
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        gem.position.set(Math.cos(angle) * 0.24 * scale, 1.12 * scale, Math.sin(angle) * 0.24 * scale);
        group.add(gem);
      }
      break;
    }
  }

  // Glowing base ring
  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.32 * scale, 0.04, 12, 24),
    glowMat
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.02;
  group.add(baseRing);

  return group;
}

// ====================== MAIN COMPONENT ======================
export default function Chess3DBoard({ board, selected, validMoves, lastMove, check, phase, onClick, autoRotate = false }: Chess3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    boardSquares: THREE.Mesh[];
    pieceMeshes: Map<number, THREE.Group>;
    highlights: THREE.Object3D[];
    particles: Array<{ points: THREE.Points; life: number; velocities: { x: number; y: number; z: number }[] }>;
    nebulaPlanes: THREE.Mesh[];
    ambientEmbers: THREE.Points | null;
    auraLight: THREE.PointLight | null;
    floatTime: number;
    animating: boolean;
    disposed: boolean;
  } | null>(null);

  const boardRef = useRef(board);
  const selectedRef = useRef(selected);
  const validRef = useRef(validMoves);
  const lastMoveRef = useRef(lastMove);
  const checkRef = useRef(check);
  const onClickRef = useRef(onClick);

  // Keep refs in sync
  useEffect(() => { onClickRef.current = onClick; }, [onClick]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { validRef.current = validMoves; }, [validMoves]);
  useEffect(() => { lastMoveRef.current = lastMove; }, [lastMove]);
  useEffect(() => { checkRef.current = check; }, [check]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current || sceneRef.current) return;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08000f);
    scene.fog = new THREE.FogExp2(0x08000f, 0.015);

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
    // In auto-rotate mode, pull back further so board doesn't clip when rotating
    if (autoRotate) {
      camera.position.set(0.5, 11, 12);
    } else {
      camera.position.set(0.5, 9, 10);
    }
    camera.lookAt(0.5, 0, 0.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.minDistance = 8;
    controls.maxDistance = 30;
    controls.target.set(0.5, 0.5, 0.5);
    if (autoRotate) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8; // cinematic slow rotation
      controls.enableZoom = false;
      controls.enablePan = false;
    }

    // Lighting
    scene.add(new THREE.AmbientLight(0x6633aa, 0.35));
    scene.add(new THREE.HemisphereLight(0x8866cc, 0x221144, 0.4));

    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
    dirLight.position.set(8, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.bias = -0.001;
    dirLight.shadow.radius = 3;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    fillLight.position.set(-8, 12, -6);
    scene.add(fillLight);

    const purplePoint = new THREE.PointLight(MAGIC_PURPLE, 2.5, 25, 2);
    purplePoint.position.set(0.5, 6, 0.5);
    purplePoint.castShadow = true;
    purplePoint.shadow.mapSize.width = 1024;
    purplePoint.shadow.mapSize.height = 1024;
    scene.add(purplePoint);

    const cyanPoint = new THREE.PointLight(NEON_CYAN, 1.5, 20, 2);
    cyanPoint.position.set(5.5, 4, 8.5);
    scene.add(cyanPoint);

    const backLight = new THREE.PointLight(0xff44aa, 1.0, 20, 2);
    backLight.position.set(-4.5, 3, -7.5);
    scene.add(backLight);

    // ===== BOARD =====
    const squareHeight = 0.12;
    const boardSize = 8;
    const borderWidth = 0.6;
    const frameOuter = boardSize + borderWidth * 2;
    const boardCenterX = 0.5;
    const boardCenterZ = 0.5;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0e, roughness: 0.15, metalness: 0.4,
      emissive: 0x050508, emissiveIntensity: 0.1
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(frameOuter, 0.5, frameOuter), frameMat);
    frame.position.set(boardCenterX, -0.25 + squareHeight / 2 - 0.005, boardCenterZ);
    frame.receiveShadow = true; frame.castShadow = true;
    scene.add(frame);

    // Inlay strips
    const inlayMat = new THREE.MeshStandardMaterial({
      color: 0x6633aa, emissive: 0x4422aa, emissiveIntensity: 0.5,
      roughness: 0.1, metalness: 0.9
    });
    const inlayDist = boardSize / 2 + borderWidth * 0.5;
    for (let side = 0; side < 4; side++) {
      const isXSide = side % 2 === 0;
      const len = frameOuter - 0.1;
      const geo = new THREE.BoxGeometry(
        isXSide ? len : 0.03, 0.015, isXSide ? 0.03 : len
      );
      const inlay = new THREE.Mesh(geo, inlayMat);
      const sign = side < 2 ? 1 : -1;
      if (isXSide) {
        inlay.position.set(boardCenterX, squareHeight / 2 + 0.005, boardCenterZ + sign * inlayDist);
      } else {
        inlay.position.set(boardCenterX + sign * inlayDist, squareHeight / 2 + 0.005, boardCenterZ);
      }
      scene.add(inlay);
    }

    // Board squares
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xf0e0f8, roughness: 0.2, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x5a2d8c, roughness: 0.3, metalness: 0.2, emissive: 0x1a0833, emissiveIntensity: 0.1 });

    const boardSquares: THREE.Mesh[] = [];
    for (let file = 0; file < 8; file++) {
      for (let rank = 0; rank < 8; rank++) {
        const isLight = (file + rank) % 2 === 1;
        const square = new THREE.Mesh(
          new THREE.BoxGeometry(SQUARE_SIZE, squareHeight, SQUARE_SIZE),
          isLight ? lightMat.clone() : darkMat.clone()
        );
        const x = file + BOARD_OFFSET + 0.5;
        const z = (7 - rank) + BOARD_OFFSET + 0.5;
        square.position.set(x, squareHeight / 2 - 0.005, z);
        square.receiveShadow = true;
        square.userData = { idx: rank * 8 + file };
        scene.add(square);
        boardSquares.push(square);
      }
    }

    // ===== MAGIC BACKGROUND =====
    const nebulaPlanes: THREE.Mesh[] = [];
    const nebulaColors = [0x3311aa, 0x6622cc, 0x220066, 0x110033, 0x4400aa];
    for (let i = 0; i < 12; i++) {
      const size = 15 + Math.random() * 30;
      const mat = new THREE.MeshBasicMaterial({
        color: nebulaColors[i % nebulaColors.length],
        transparent: true, opacity: 0.06 + Math.random() * 0.08,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      const angle = (i / 12) * Math.PI * 2;
      const dist = 12 + Math.random() * 15;
      plane.position.set(Math.cos(angle) * dist * 0.5, -2 + Math.random() * 12, Math.sin(angle) * dist * 0.5 - 5);
      plane.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      plane.userData.rotSpeed = { x: (Math.random() - 0.5) * 0.002, y: (Math.random() - 0.5) * 0.003, z: (Math.random() - 0.5) * 0.001 };
      plane.userData.baseY = plane.position.y;
      scene.add(plane);
      nebulaPlanes.push(plane);
    }

    // Embers
    const emberCount = 600;
    const emberPos = new Float32Array(emberCount * 3);
    const emberCol = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 18;
      emberPos[i * 3] = Math.cos(a) * r;
      emberPos[i * 3 + 1] = -3 + Math.random() * 20;
      emberPos[i * 3 + 2] = Math.sin(a) * r;
      const c = Math.random();
      if (c < 0.4) { emberCol[i*3]=0.6; emberCol[i*3+1]=0.15; emberCol[i*3+2]=1.0; }
      else if (c < 0.7) { emberCol[i*3]=0.0; emberCol[i*3+1]=0.85; emberCol[i*3+2]=1.0; }
      else { emberCol[i*3]=1.0; emberCol[i*3+1]=0.2; emberCol[i*3+2]=0.6; }
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    emberGeo.setAttribute("color", new THREE.BufferAttribute(emberCol, 3));
    const ambientEmbers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      size: 0.1, vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    scene.add(ambientEmbers);

    // Fire columns
    for (let side = 0; side < 4; side++) {
      const fireCount = 150;
      const fp = new Float32Array(fireCount * 3);
      const fc = new Float32Array(fireCount * 3);
      const a = (side / 4) * Math.PI * 2 + Math.PI / 4;
      const d = 7;
      for (let i = 0; i < fireCount; i++) {
        fp[i*3] = Math.cos(a) * d + (Math.random() - 0.5) * 0.8;
        fp[i*3+1] = Math.random() * 10 - 1;
        fp[i*3+2] = Math.sin(a) * d + (Math.random() - 0.5) * 0.8;
        const t = fp[i*3+1] / 10;
        fc[i*3] = 0.9 - t * 0.5;
        fc[i*3+1] = 0.2 * (1 - t);
        fc[i*3+2] = 0.3 + t * 0.7;
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
      fg.setAttribute("color", new THREE.BufferAttribute(fc, 3));
      const fire = new THREE.Points(fg, new THREE.PointsMaterial({
        size: 0.15, vertexColors: true, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      fire.userData.fireColumn = true;
      fire.userData.baseAngle = a;
      fire.userData.dist = d;
      scene.add(fire);
    }

    const auraLight = new THREE.PointLight(0x9945ff, 1.5, 30, 2);
    auraLight.position.set(0.5, 3, 0.5);
    scene.add(auraLight);

    // ===== CLICK HANDLING =====
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Build list of clickable objects: pieces + board squares + highlight rings
      const s = sceneRef.current;
      const clickTargets: THREE.Object3D[] = [...boardSquares];
      if (s) {
        s.pieceMeshes.forEach(mesh => clickTargets.push(mesh));
        s.highlights.forEach(h => clickTargets.push(h));
      }

      const intersects = raycaster.intersectObjects(clickTargets, true);
      if (intersects.length === 0) {
        // Last resort: raycast against a virtual ground plane at board height
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06);
        const hitPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, hitPoint);
        if (hitPoint) {
          const file = Math.round(hitPoint.x - BOARD_OFFSET - 0.5);
          const rankInv = Math.round(hitPoint.z - BOARD_OFFSET - 0.5);
          const rank = 7 - rankInv;
          if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
            onClickRef.current(rank * 8 + file);
          }
        }
        return;
      }

      let clickedIdx: number | null = null;

      // Check ALL intersections — find the first one with a valid idx
      // Prefer piece hits over board square hits (pieces sit on top of squares)
      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData && obj.userData.idx !== undefined) {
            clickedIdx = obj.userData.idx as number;
            break;
          }
          obj = obj.parent;
        }
        if (clickedIdx !== null) break;
      }

      // Fallback: compute from closest hit world position
      if (clickedIdx === null) {
        const point = intersects[0].point;
        const file = Math.round(point.x - BOARD_OFFSET - 0.5);
        const rankInv = Math.round(point.z - BOARD_OFFSET - 0.5);
        const rank = 7 - rankInv;
        if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
          clickedIdx = rank * 8 + file;
        }
      }

      // Debug: log clicked square
      if (clickedIdx !== null) {
        const file = clickedIdx & 7;
        const rank = clickedIdx >> 3;
        console.log(`[3D] Clicked: ${String.fromCharCode(97 + file)}${rank + 1} (idx=${clickedIdx})`);
      }

      if (clickedIdx !== null && clickedIdx >= 0 && clickedIdx < 64) {
        onClickRef.current(clickedIdx);
      }
    };

    renderer.domElement.addEventListener("click", handleClick);

    // Resize handler
    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const state = {
      scene, camera, renderer, controls, boardSquares,
      pieceMeshes: new Map<number, THREE.Group>(),
      highlights: [] as THREE.Object3D[],
      particles: [] as Array<{ points: THREE.Points; life: number; velocities: { x: number; y: number; z: number }[] }>,
      nebulaPlanes, ambientEmbers, auraLight,
      floatTime: 0, animating: false, disposed: false,
    };
    sceneRef.current = state;

    // Animation loop
    const animate = () => {
      if (state.disposed) return;
      requestAnimationFrame(animate);
      state.floatTime += 0.016;
      controls.update();

      // Particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.life--;
        const pos = p.points.geometry.attributes.position.array as Float32Array;
        for (let j = 0; j < pos.length; j += 3) {
          const idx = j / 3;
          pos[j] += p.velocities[idx].x;
          pos[j + 1] += p.velocities[idx].y;
          pos[j + 2] += p.velocities[idx].z;
          p.velocities[idx].y -= 0.005;
        }
        p.points.geometry.attributes.position.needsUpdate = true;
        (p.points.material as THREE.PointsMaterial).opacity = p.life / 58;
        if (p.life <= 0) {
          scene.remove(p.points);
          state.particles.splice(i, 1);
        }
      }

      // Background animations
      const t = state.floatTime;
      nebulaPlanes.forEach(plane => {
        const rs = plane.userData.rotSpeed;
        plane.rotation.x += rs.x;
        plane.rotation.y += rs.y;
        plane.rotation.z += rs.z;
        plane.position.y = plane.userData.baseY + Math.sin(t * 0.3 + plane.position.x) * 0.5;
      });

      if (ambientEmbers) {
        const epos = ambientEmbers.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < epos.length; i += 3) {
          epos[i + 1] += 0.008 + Math.random() * 0.005;
          const ea = Math.atan2(epos[i + 2], epos[i]) + 0.002;
          const er = Math.sqrt(epos[i] * epos[i] + epos[i + 2] * epos[i + 2]);
          epos[i] = Math.cos(ea) * er;
          epos[i + 2] = Math.sin(ea) * er;
          if (epos[i + 1] > 18) {
            epos[i + 1] = -2;
            const na = Math.random() * Math.PI * 2;
            const nr = 3 + Math.random() * 18;
            epos[i] = Math.cos(na) * nr;
            epos[i + 2] = Math.sin(na) * nr;
          }
        }
        ambientEmbers.geometry.attributes.position.needsUpdate = true;
      }

      scene.children.forEach(child => {
        if (child.userData?.fireColumn) {
          const fp = (child as THREE.Points).geometry.attributes.position.array as Float32Array;
          for (let i = 0; i < fp.length; i += 3) {
            fp[i + 1] += 0.03 + Math.random() * 0.02;
            fp[i] += (Math.random() - 0.5) * 0.02;
            fp[i + 2] += (Math.random() - 0.5) * 0.02;
            if (fp[i + 1] > 10) {
              fp[i + 1] = -1 + Math.random();
              fp[i] = Math.cos(child.userData.baseAngle) * child.userData.dist + (Math.random() - 0.5) * 0.8;
              fp[i + 2] = Math.sin(child.userData.baseAngle) * child.userData.dist + (Math.random() - 0.5) * 0.8;
            }
          }
          (child as THREE.Points).geometry.attributes.position.needsUpdate = true;
          ((child as THREE.Points).material as THREE.PointsMaterial).opacity = 0.35 + Math.sin(t * 2 + child.userData.baseAngle) * 0.15;
        }
      });

      if (auraLight) {
        auraLight.intensity = 1.5 + Math.sin(t * 1.5) * 0.8;
        auraLight.color.setHSL(0.75 + Math.sin(t * 0.5) * 0.05, 0.9, 0.5);
      }

      // Piece float
      state.pieceMeshes.forEach((mesh, idx) => {
        mesh.position.y = 0.12 + Math.sin(t * 1.5 + idx) * 0.015;
      });

      // Highlight float
      state.highlights.forEach((h, i) => {
        if ((h as THREE.Mesh).geometry?.type === "TorusGeometry") {
          h.position.y = 0.13 + Math.sin(t * 3 + i) * 0.03;
        }
        // Pulse the last-move glow discs
        if (h.userData.isLastMoveGlow) {
          const mat = (h as THREE.Mesh).material as THREE.MeshStandardMaterial;
          const phase = h.userData.pulsePhase || 0;
          const pulse = 0.5 + Math.sin(t * 3 + phase) * 0.5;
          mat.emissiveIntensity = 1.5 + pulse * 2;
          mat.opacity = 0.5 + pulse * 0.3;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      state.disposed = true;
      renderer.domElement.removeEventListener("click", handleClick);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Sync board state to 3D scene
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const prevBoard = boardRef.current;
    boardRef.current = board;

    // Find which piece moved (for animation)
    let movedFrom = -1;
    let movedTo = -1;
    for (let i = 0; i < 64; i++) {
      if (prevBoard[i] !== 0 && board[i] === 0 && prevBoard[i] !== board[i]) {
        // A piece left this square
        if (movedFrom === -1) movedFrom = i;
      }
      if (board[i] !== 0 && prevBoard[i] !== board[i]) {
        // A piece appeared/changed here
        if (movedTo === -1) movedTo = i;
      }
    }

    // Remove all existing pieces and rebuild
    // (simpler and avoids complex diffing for castling/en passant/promotion)
    s.pieceMeshes.forEach((mesh) => s.scene.remove(mesh));
    s.pieceMeshes.clear();

    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const type = pieceTypeFromEncoding(p);
      if (!type) continue;
      const white = isW(p);
      const mesh = createPieceMesh(type, white);
      const pos = idxToWorld(i);
      mesh.position.copy(pos);
      mesh.userData = { idx: i };
      // Tag all children with idx for raycasting
      mesh.traverse(child => { child.userData.idx = i; });
      s.scene.add(mesh);
      s.pieceMeshes.set(i, mesh);
    }

    // Sparkle burst at the destination if a piece moved
    if (movedTo >= 0) {
      const toPos = idxToWorld(movedTo);
      const count = 60;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = toPos.x + (Math.random() - 0.5) * 1.2;
        positions[i * 3 + 1] = toPos.y + Math.random() * 2.2;
        positions[i * 3 + 2] = toPos.z + (Math.random() - 0.5) * 1.2;
        const cyan = Math.random() > 0.5;
        colors[i * 3] = cyan ? 0 : 0.6;
        colors[i * 3 + 1] = cyan ? 1 : 0.3;
        colors[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.12, vertexColors: true, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthTest: false
      }));
      s.scene.add(pts);
      s.particles.push({
        points: pts, life: 58,
        velocities: Array(count).fill(null).map(() => ({
          x: (Math.random() - 0.5) * 0.14,
          y: 0.09 + Math.random() * 0.18,
          z: (Math.random() - 0.5) * 0.14
        }))
      });
    }
  }, [board]);

  // Sync highlights (selection + valid moves)
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    // Clear old highlights
    s.highlights.forEach(h => s.scene.remove(h));
    s.highlights = [];

    // Last move highlight — pulsing pink aura on source + destination squares
    if (lastMove) {
      [lastMove.f, lastMove.t].forEach((idx, i) => {
        const pos = idxToWorld(idx);
        // Glowing disc on square
        const discGeo = new THREE.CircleGeometry(0.45, 32);
        const discMat = new THREE.MeshStandardMaterial({
          color: 0xff44aa,
          emissive: 0xff44aa,
          emissiveIntensity: i === 1 ? 2.5 : 1.5, // destination brighter
          transparent: true,
          opacity: i === 1 ? 0.7 : 0.4,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.copy(pos);
        disc.position.y = 0.07;
        (disc as any).userData.pulsePhase = i * Math.PI;
        (disc as any).userData.isLastMoveGlow = true;
        s.scene.add(disc);
        s.highlights.push(disc);
      });
    }

    // Selected square highlight
    if (selected !== null) {
      const selPos = idxToWorld(selected);
      const selGeo = new THREE.BoxGeometry(0.96, 0.02, 0.96);
      const selMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 1.5,
        transparent: true, opacity: 0.4
      });
      const selMesh = new THREE.Mesh(selGeo, selMat);
      selMesh.position.copy(selPos);
      selMesh.position.y = 0.125;
      s.scene.add(selMesh);
      s.highlights.push(selMesh);
    }

    // Valid move highlights
    validMoves.forEach(idx => {
      const pos = idxToWorld(idx);
      const isCapture = board[idx] !== 0;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.06, 16, 32),
        new THREE.MeshStandardMaterial({
          color: isCapture ? 0xff4466 : NEON_CYAN,
          emissive: isCapture ? 0xff2244 : NEON_CYAN,
          emissiveIntensity: 2.5,
          transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.9
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(pos);
      ring.position.y = 0.13;
      ring.userData.idx = idx;
      ring.traverse(c => { c.userData.idx = idx; });
      s.scene.add(ring);
      s.highlights.push(ring);

      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(isCapture ? 0.35 : 0.12, 16),
        new THREE.MeshStandardMaterial({
          color: isCapture ? 0xff4466 : NEON_CYAN,
          emissive: isCapture ? 0xff2244 : NEON_CYAN,
          emissiveIntensity: 1.5,
          transparent: true, opacity: isCapture ? 0.3 : 0.5, roughness: 0.1, metalness: 0.9
        })
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.copy(pos);
      dot.position.y = 0.125;
      dot.userData.idx = idx;
      s.scene.add(dot);
      s.highlights.push(dot);
    });
  }, [selected, validMoves, board]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 500,
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
      }}
    />
  );
}
