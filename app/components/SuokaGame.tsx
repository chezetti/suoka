"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// TypeScript types for game state
interface GameState {
  score: number;
  best: number;
  nextValue: number;
  running: boolean;
  paused: boolean;
  ended: boolean;
  endReason: string;
}

interface CircleData {
  body: any;
  value: number;
  bornAt: number;
  id: number;
}

interface Animation {
  startTime: number;
  duration: number;
  type: "merge" | "spawn";
  targetX?: number;
  targetY?: number;
  startX?: number;
  startY?: number;
  scale?: number;
}

interface MergeRequest {
  bodyAId: number;
  bodyBId: number;
  x: number;
  y: number;
  value: number;
  timestamp: number;
}

// Particle pool with SoA layout for better cache performance
class ParticlePool {
  private capacity: number;
  private count: number;
  private freeList: number[];

  // Structure of Arrays for better cache locality
  public x: Float32Array;
  public y: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public size: Float32Array;
  public maxSize: Float32Array;
  public life: Float32Array;
  public maxLife: Float32Array;
  public startTime: Float32Array;
  public colorIndex: Uint8Array; // Index into color palette

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.count = 0;
    this.freeList = [];

    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.maxSize = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.startTime = new Float32Array(capacity);
    this.colorIndex = new Uint8Array(capacity);

    // Pre-populate free list
    for (let i = capacity - 1; i >= 0; i--) {
      this.freeList.push(i);
    }
  }

  acquire(): number {
    if (this.freeList.length === 0) return -1;
    const index = this.freeList.pop()!;
    this.count++;
    return index;
  }

  release(index: number): void {
    if (index < 0 || index >= this.capacity) return;
    this.freeList.push(index);
    this.count--;
  }

  clear(): void {
    this.count = 0;
    this.freeList.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) {
      this.freeList.push(i);
    }
  }

  getActiveCount(): number {
    return this.count;
  }

  getCapacity(): number {
    return this.capacity;
  }
}

// Sprite cache for pre-rendered circles
class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private colorPalette: string[] = [];

  constructor() {
    // Pre-define color palette for indexing
    this.colorPalette = [
      "#c7d2fe",
      "#a78bfa",
      "#60a5fa",
      "#67e8f9",
      "#34d399",
      "#facc15",
      "#f97316",
      "#ef4444",
      "#ec4899",
      "#d946ef",
      "#a855f7",
      "#8b5cf6",
      "#7c3aed",
      "#ddd6fe",
    ];
  }

  getColorIndex(value: number): number {
    const colorMap: { [key: number]: number } = {
      2: 0,
      4: 1,
      8: 2,
      16: 3,
      32: 4,
      64: 5,
      128: 6,
      256: 7,
      512: 8,
      1024: 9,
      2048: 10,
      4096: 11,
      8192: 12,
    };
    return colorMap[value] ?? 13;
  }

  getColor(index: number): string {
    return this.colorPalette[index] || "#ddd6fe";
  }

  private generateCacheKey(
    value: number,
    radiusBucket: number,
    dpr: number
  ): string {
    return `${value}_${radiusBucket}_${dpr}`;
  }

  getSprite(value: number, radius: number, dpr: number): HTMLCanvasElement {
    // Quantize radius to buckets to reduce cache misses
    const radiusBucket = Math.round(radius / 4) * 4;
    const key = this.generateCacheKey(value, radiusBucket, dpr);

    let sprite = this.cache.get(key);
    if (!sprite) {
      sprite = this.createSprite(value, radiusBucket, dpr);
      this.cache.set(key, sprite);
    }
    return sprite;
  }

  private createSprite(
    value: number,
    radius: number,
    dpr: number
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const size = radius * 2 + 40; // Extra padding for glow
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const centerX = size / 2;
    const centerY = size / 2;
    const fill = this.getColor(this.getColorIndex(value));

    // Pre-render all visual elements
    ctx.save();

    // Outer glow
    ctx.shadowColor = fill;
    ctx.shadowBlur = 12;
    ctx.globalCompositeOperation = "source-over";

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    // Reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    // Inner shadow for depth
    const innerShadowGrad = ctx.createRadialGradient(
      centerX,
      centerY,
      radius * 0.7,
      centerX,
      centerY,
      radius
    );
    innerShadowGrad.addColorStop(0, "rgba(0,0,0,0)");
    innerShadowGrad.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = innerShadowGrad;
    ctx.fill();

    // Inner ring stroke
    ctx.lineWidth = Math.max(1, 3);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(1, radius - 2), 0, Math.PI * 2);
    ctx.stroke();

    // Inner glass highlight
    const highlightGrad = ctx.createRadialGradient(
      centerX - radius * 0.3,
      centerY - radius * 0.4,
      0,
      centerX - radius * 0.3,
      centerY - radius * 0.4,
      radius * 0.6
    );
    highlightGrad.addColorStop(0, "rgba(255,255,255,0.25)");
    highlightGrad.addColorStop(0.3, "rgba(255,255,255,0.15)");
    highlightGrad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(1, radius - 1), 0, Math.PI * 2);
    ctx.fillStyle = highlightGrad;
    ctx.fill();

    // Text with glow effect
    if (radius > 12) {
      const fontSize = Math.max(10, 18 * (radius / 34));
      ctx.font = `bold ${fontSize}px 'Inter Tight', Inter, ui-sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Text glow
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(value), centerX, centerY);

      // Additional text layer
      ctx.shadowBlur = 4;
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(String(value), centerX, centerY);
    }

    ctx.restore();
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// High-performance adaptive timestep runner for 144+ FPS
class AdaptiveStepRunner {
  private accumulator = 0;
  private lastTime = 0;
  private targetFPS = 144;
  private readonly minDt = 1000 / 240; // Max 240 FPS physics
  private readonly maxDt = 1000 / 30; // Min 30 FPS fallback
  private readonly maxFrameTime = 100; // Reduced frame cap for responsiveness
  private frameCount = 0;
  private fpsCheckTime = 0;
  private currentFPS = 60;

  constructor() {
    // Detect monitor refresh rate
    this.detectRefreshRate();
  }

  private detectRefreshRate(): void {
    // Try to detect high refresh rate displays
    const startTime = performance.now();
    let frameCount = 0;

    const detect = () => {
      frameCount++;
      if (frameCount < 10) {
        requestAnimationFrame(detect);
      } else {
        const elapsed = performance.now() - startTime;
        const detectedFPS = Math.round((frameCount * 1000) / elapsed);

        // Set target based on detected refresh rate
        if (detectedFPS >= 120) {
          this.targetFPS = Math.min(detectedFPS, 240); // Cap at 240 FPS
        } else {
          this.targetFPS = 60;
        }
      }
    };

    requestAnimationFrame(detect);
  }

  update(currentTime: number, updateFn: (dt: number) => void): void {
    if (this.lastTime === 0) {
      this.lastTime = currentTime;
      this.fpsCheckTime = currentTime;
      return;
    }

    let frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Track FPS for adaptive optimization
    this.frameCount++;
    if (currentTime - this.fpsCheckTime >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.fpsCheckTime = currentTime;

      // Auto-adjust target based on performance
      if (this.currentFPS < this.targetFPS * 0.9) {
        this.targetFPS = Math.max(60, this.targetFPS * 0.95);
      }
    }

    // Adaptive timestep based on target FPS
    const adaptiveDt = 1000 / this.targetFPS;

    // Clamp frame time
    frameTime = Math.min(frameTime, this.maxFrameTime);
    this.accumulator += frameTime;

    // Process adaptive timesteps
    while (this.accumulator >= adaptiveDt) {
      const dt = Math.max(this.minDt, Math.min(this.maxDt, adaptiveDt));
      updateFn(dt);
      this.accumulator -= adaptiveDt;
    }
  }

  getCurrentFPS(): number {
    return this.currentFPS;
  }

  getTargetFPS(): number {
    return this.targetFPS;
  }

  reset(): void {
    this.accumulator = 0;
    this.lastTime = 0;
    this.frameCount = 0;
    this.fpsCheckTime = 0;
  }
}

// Game state store for React synchronization
class GameStateStore {
  private state: GameState;
  private listeners = new Set<() => void>();
  private updateThrottle = 0;
  private readonly throttleMs = 100; // 10 Hz updates to React

  constructor(initialState: GameState) {
    this.state = { ...initialState };
  }

  getState(): GameState {
    return this.state;
  }

  setState(newState: Partial<GameState>): void {
    const now = performance.now();
    if (now - this.updateThrottle < this.throttleMs) return;

    this.updateThrottle = now;
    this.state = { ...this.state, ...newState };
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Extend Window interface for custom properties
declare global {
  interface Window {
    _suokaListeners?: {
      handleResize?: () => void;
    };
  }
}

export default function SuokaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageBoardRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<any>(null);
  const storeRef = useRef<GameStateStore | null>(null);

  // Initialize store once
  if (!storeRef.current) {
    storeRef.current = new GameStateStore({
      score: 0,
      best: 0,
      nextValue: 2,
      running: false,
      paused: false,
      ended: false,
      endReason: "",
    });
  }

  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    best: 0,
    nextValue: 2,
    running: false,
    paused: false,
    ended: false,
    endReason: "",
  });

  // Subscribe to store changes
  useEffect(() => {
    if (!storeRef.current) return;

    const unsubscribe = storeRef.current.subscribe(() => {
      if (storeRef.current) {
        setGameState(storeRef.current.getState());
      }
    });

    // Set initial state
    setGameState(storeRef.current.getState());

    return unsubscribe;
  }, []);

  const [showModal, setShowModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Initialize game when component mounts
  useEffect(() => {
    if (typeof window === "undefined") return;

    const store = storeRef.current!;

    // Load best score from localStorage on client side
    const savedBest = Number(localStorage.getItem("circle2048.best") || 0);
    store.setState({ best: savedBest });

    const initGame = async () => {
      // Import Matter.js dynamically to avoid SSR issues
      const Matter = await import("matter-js");
      const { Engine, World, Bodies, Body, Events, Vector } = Matter;

      if (!canvasRef.current || !stageBoardRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d")!;
      const stageBoard = stageBoardRef.current;

      // Initialize systems
      const particlePool = new ParticlePool(300);
      const spriteCache = new SpriteCache();
      const stepRunner = new AdaptiveStepRunner();
      let resizeObserver: ResizeObserver | null = null;
      let rafId = 0;
      let lastBestSave = 0;

      // Calculate board dimensions dynamically
      function calculateBoardDimensions() {
        const boardRect = stageBoard.getBoundingClientRect();
        const isMobile = window.innerWidth <= 768;

        const computedStyle = window.getComputedStyle(stageBoard);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

        const totalHorizontalPadding = paddingLeft + paddingRight;
        const totalVerticalPadding = paddingTop + paddingBottom;

        const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
        const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
        const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
        const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;

        const totalHorizontalBorder = borderLeft + borderRight;
        const totalVerticalBorder = borderTop + borderBottom;

        let dynamicBoardW = Math.floor(
          boardRect.width - totalHorizontalPadding - totalHorizontalBorder
        );
        let dynamicBoardH = Math.floor(
          boardRect.height - totalVerticalPadding - totalVerticalBorder
        );

        if (isMobile) {
          dynamicBoardW = Math.max(280, Math.min(dynamicBoardW, 800));
          dynamicBoardH = Math.max(400, Math.min(dynamicBoardH, 1000));
        } else {
          dynamicBoardW = Math.max(500, Math.min(dynamicBoardW, 1200));
          dynamicBoardH = Math.max(500, Math.min(dynamicBoardH, 1000));
        }

        return { dynamicBoardW, dynamicBoardH, isMobile };
      }

      let { dynamicBoardW, dynamicBoardH, isMobile } =
        calculateBoardDimensions();

      // Function to calculate radius based on value and screen size
      function getRadiusForValue(value: number): number {
        const minDimension = Math.min(dynamicBoardW, dynamicBoardH);
        let baseRadius: number;

        if (isMobile) {
          baseRadius = Math.max(16, Math.min(32, minDimension * 0.08));
        } else {
          baseRadius = 34;
        }

        const scaleFactor = Math.log2(value / 2) * 0.15;
        const minRadius = Math.max(12, baseRadius * 0.5);
        const maxRadius = Math.max(40, baseRadius * 1.8);

        return Math.max(
          minRadius,
          Math.min(maxRadius, baseRadius + scaleFactor * baseRadius)
        );
      }

      const cfg = {
        boardW: dynamicBoardW,
        boardH: dynamicBoardH,
        get radius() {
          const minDimension = Math.min(dynamicBoardW, dynamicBoardH);
          return isMobile
            ? Math.max(16, Math.min(32, minDimension * 0.08))
            : 34;
        },
        getRadiusForValue,
        get dangerLineY() {
          return isMobile
            ? Math.max(80, Math.min(150, dynamicBoardH * 0.2))
            : 120;
        },
        get spawnY() {
          const maxSpawnValue = 32;
          const maxRadius = getRadiusForValue(maxSpawnValue);
          const minSpawnY = maxRadius;
          const dangerOffset = maxRadius + 120;
          return Math.max(minSpawnY, this.dangerLineY - dangerOffset);
        },
        gracePeriodMs: 800,
        dropCooldownMs: 400,
        gravity: 1.0,
        restitution: 0.08,
        friction: 0.25,
        frictionStatic: 0.55,
        frictionAir: 0.01,
        sleepThreshold: 60,
        maxVelocity: 900,
        maxCircles: 150,
        mergeSpeedMax: 200,
        mergeRelSpeedMax: 300,
        valueDist: [2, 2, 2, 2, 2, 4, 4, 8, 16, 32],
        scoreMul: 1,
      };

      // High-performance canvas setup for 144+ FPS
      const baseDpr = window.devicePixelRatio || 1;
      const targetFPS = stepRunner.getTargetFPS();

      // Adaptive DPR based on target FPS for performance
      let dpr: number;
      if (targetFPS >= 144) {
        // Reduce DPR for ultra-high refresh rates
        dpr = isMobile ? Math.min(1.2, baseDpr) : Math.min(1.5, baseDpr);
      } else if (targetFPS >= 120) {
        dpr = isMobile ? Math.min(1.3, baseDpr) : Math.min(1.8, baseDpr);
      } else {
        dpr = isMobile ? Math.min(1.5, baseDpr) : Math.min(2, baseDpr);
      }

      canvas.width = cfg.boardW * dpr;
      canvas.height = cfg.boardH * dpr;
      canvas.style.width = cfg.boardW + "px";
      canvas.style.height = cfg.boardH + "px";

      // GPU acceleration hints
      canvas.style.transform = "translate3d(0,0,0)";
      canvas.style.willChange = "transform";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Optimized canvas settings for high FPS
      if (targetFPS >= 120) {
        ctx.imageSmoothingEnabled = false; // Disable for ultra-high FPS
      } else if (isMobile) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
      }

      // Enable hardware acceleration hints
      const contextAttributes = (ctx as any).getContextAttributes?.();
      if (contextAttributes) {
        contextAttributes.willReadFrequently = true;
        contextAttributes.alpha = false; // Disable alpha for better performance
      }

      const rollValue = () =>
        cfg.valueDist[Math.floor(Math.random() * cfg.valueDist.length)];

      // High-performance physics engine setup
      const engine = Engine.create({
        enableSleeping: true,
      });
      engine.world.gravity.y = cfg.gravity;

      // Adaptive physics quality based on target FPS
      if (targetFPS >= 144) {
        engine.velocityIterations = 3; // Reduced for ultra-high FPS
        engine.positionIterations = 3;
      } else if (targetFPS >= 120) {
        engine.velocityIterations = 4;
        engine.positionIterations = 4;
      } else {
        engine.velocityIterations = 6; // Higher quality for standard FPS
        engine.positionIterations = 6;
      }

      // Walls
      const WALL_THICK = cfg.radius * 2;
      let walls = [
        Bodies.rectangle(
          -WALL_THICK / 2,
          cfg.boardH / 2,
          WALL_THICK,
          cfg.boardH + WALL_THICK,
          {
            isStatic: true,
            label: "wall",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW + WALL_THICK / 2,
          cfg.boardH / 2,
          WALL_THICK,
          cfg.boardH + WALL_THICK,
          {
            isStatic: true,
            label: "wall",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW / 2,
          cfg.boardH + WALL_THICK / 2,
          cfg.boardW + WALL_THICK * 2,
          WALL_THICK,
          {
            isStatic: true,
            label: "floor",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW / 2,
          -WALL_THICK,
          cfg.boardW + WALL_THICK * 2,
          WALL_THICK,
          {
            isStatic: true,
            label: "ceiling",
            render: { visible: false },
          }
        ),
      ];
      World.add(engine.world, walls);

      // Game state
      const state = {
        previewX: cfg.boardW / 2,
        score: 0,
        best: savedBest,
        nextValue: rollValue(),
        running: false,
        paused: false,
        lastDropTs: performance.now(),
        ended: false,
        endReason: "",
        circles: new Map<number, CircleData>(),
        nextLocalId: 1,
        mergingCircles: new Set<number>(),
        animations: new Map<number, Animation>(),
        mergeQueue: [] as MergeRequest[],
        highestCircleTop: cfg.boardH, // Track for O(1) danger line check
        previewUpdateTime: 0,
      };

      // Sync initial state
      store.setState({
        score: state.score,
        best: state.best,
        nextValue: state.nextValue,
        running: state.running,
        paused: state.paused,
        ended: state.ended,
        endReason: state.endReason,
      });

      // Create circle function
      function createCircle(
        x: number,
        y: number,
        value: number
      ): CircleData | null {
        if (state.circles.size >= cfg.maxCircles) {
          showToastMessage("Object limit reached");
          return null;
        }

        const radius = cfg.getRadiusForValue(value);
        const body = Bodies.circle(x, y, radius, {
          label: "circle",
          restitution: cfg.restitution,
          friction: cfg.friction,
          frictionStatic: cfg.frictionStatic,
          frictionAir: cfg.frictionAir,
          sleepThreshold: cfg.sleepThreshold,
        });

        World.add(engine.world, body);
        const data: CircleData = {
          body,
          value,
          bornAt: performance.now(),
          id: state.nextLocalId++,
        };
        state.circles.set(body.id, data);
        return data;
      }

      // Remove circle function
      function removeCircle(bodyId: number): void {
        const data = state.circles.get(bodyId);
        if (!data) return;
        try {
          World.remove(engine.world, data.body);
        } catch {}
        state.circles.delete(bodyId);
        state.mergingCircles.delete(bodyId);
      }

      // Collision handling - just queue merges
      Events.on(engine, "collisionStart", ({ pairs }) => {
        const now = performance.now();
        for (const { bodyA, bodyB } of pairs) {
          if (bodyA.label !== "circle" || bodyB.label !== "circle") continue;
          const A = state.circles.get(bodyA.id);
          const B = state.circles.get(bodyB.id);
          if (!A || !B || A.value !== B.value) continue;

          if (
            state.mergingCircles.has(bodyA.id) ||
            state.mergingCircles.has(bodyB.id)
          )
            continue;

          const speedA = Vector.magnitude(bodyA.velocity);
          const speedB = Vector.magnitude(bodyB.velocity);
          const relV = Vector.sub(bodyA.velocity, bodyB.velocity);
          const relSpeed = Vector.magnitude(relV);

          const canMerge =
            speedA < cfg.mergeSpeedMax &&
            speedB < cfg.mergeSpeedMax &&
            relSpeed < cfg.mergeRelSpeedMax;

          if (canMerge) {
            // Queue merge instead of processing immediately
            state.mergeQueue.push({
              bodyAId: bodyA.id,
              bodyBId: bodyB.id,
              x: (bodyA.position.x + bodyB.position.x) / 2,
              y: (bodyA.position.y + bodyB.position.y) / 2,
              value: A.value,
              timestamp: now,
            });
          }
        }
      });

      // Process merge queue (called after physics step)
      function processMergeQueue(): void {
        while (state.mergeQueue.length > 0) {
          const merge = state.mergeQueue.shift()!;
          const A = state.circles.get(merge.bodyAId);
          const B = state.circles.get(merge.bodyBId);

          if (
            !A ||
            !B ||
            state.mergingCircles.has(A.body.id) ||
            state.mergingCircles.has(B.body.id)
          ) {
            continue;
          }

          performMerge(A, B, merge.x, merge.y);
        }
      }

      // Merge function - deterministic, no setTimeout
      function performMerge(
        A: CircleData,
        B: CircleData,
        x: number,
        y: number
      ): void {
        state.mergingCircles.add(A.body.id);
        state.mergingCircles.add(B.body.id);

        const newValue = A.value * 2;
        createMergeExplosion(
          x,
          y,
          spriteCache.getColorIndex(A.value),
          spriteCache.getColorIndex(newValue),
          A.value
        );

        // Store merge animations
        const now = performance.now();
        state.animations.set(A.body.id, {
          startTime: now,
          duration: 300,
          type: "merge",
          targetX: x,
          targetY: y,
          startX: A.body.position.x,
          startY: A.body.position.y,
        });
        state.animations.set(B.body.id, {
          startTime: now,
          duration: 300,
          type: "merge",
          targetX: x,
          targetY: y,
          startX: B.body.position.x,
          startY: B.body.position.y,
        });

        state.score += newValue * cfg.scoreMul;
        if (state.score > state.best) {
          state.best = state.score;
          // Debounce localStorage writes
          const now = performance.now();
          if (now - lastBestSave > 1000) {
            localStorage.setItem("circle2048.best", String(state.best));
            lastBestSave = now;
          }
        }

        store.setState({ score: state.score, best: state.best });

        // Schedule creation of new circle (deterministic timing)
        setTimeout(() => {
          removeCircle(A.body.id);
          removeCircle(B.body.id);
          state.mergingCircles.delete(A.body.id);
          state.mergingCircles.delete(B.body.id);

          const C = createCircle(x, y, newValue);
          if (C) {
            state.animations.set(C.body.id, {
              startTime: performance.now(),
              duration: 200,
              type: "spawn",
              scale: 0,
            });
            Body.applyForce(C.body, C.body.position, { x: 0, y: 0.005 });
          }
        }, 300);
      }

      // Particle system
      function createMergeExplosion(
        x: number,
        y: number,
        oldColorIndex: number,
        newColorIndex: number,
        circleValue = 2
      ): void {
        const particleCount = 8 + Math.floor(Math.random() * 4);
        const circleRadius = cfg.getRadiusForValue(circleValue);
        const sizeMultiplier = circleRadius / cfg.radius;

        for (let i = 0; i < particleCount; i++) {
          const particleIndex = particlePool.acquire();
          if (particleIndex === -1) break; // Pool exhausted

          const angle =
            (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
          const speed = (80 + Math.random() * 40) * sizeMultiplier;
          const size = (3 + Math.random() * 4) * sizeMultiplier;
          const life = 600 + Math.random() * 300;

          particlePool.x[particleIndex] = x;
          particlePool.y[particleIndex] = y;
          particlePool.vx[particleIndex] = Math.cos(angle) * speed;
          particlePool.vy[particleIndex] = Math.sin(angle) * speed;
          particlePool.size[particleIndex] = size;
          particlePool.maxSize[particleIndex] = size;
          particlePool.life[particleIndex] = life;
          particlePool.maxLife[particleIndex] = life;
          particlePool.startTime[particleIndex] = performance.now();
          particlePool.colorIndex[particleIndex] =
            Math.random() > 0.5 ? oldColorIndex : newColorIndex;
        }
      }

      // High-performance particle update with adaptive timestep
      let lastParticleUpdate = 0;
      function updateParticles(): void {
        const now = performance.now();
        const targetFPS = stepRunner.getTargetFPS();

        // Adaptive timestep for particles based on FPS
        const particleUpdateInterval =
          targetFPS >= 144 ? 8 : targetFPS >= 120 ? 12 : 16;
        if (now - lastParticleUpdate < particleUpdateInterval) return;

        const dt = (now - lastParticleUpdate) / 1000; // Convert to seconds
        lastParticleUpdate = now;

        // Batch process particles for better cache performance
        const activeParticles: number[] = [];

        // First pass: collect active particles and handle expired ones
        for (let i = 0; i < particlePool.getCapacity(); i++) {
          if (particlePool.life[i] <= 0) continue;

          const elapsed = now - particlePool.startTime[i];
          if (elapsed >= particlePool.maxLife[i]) {
            particlePool.release(i);
            continue;
          }

          activeParticles.push(i);
        }

        // Second pass: update active particles in batch
        const gravity = 200;
        const damping = 0.98;

        for (const i of activeParticles) {
          // Physics update
          particlePool.x[i] += particlePool.vx[i] * dt;
          particlePool.y[i] += particlePool.vy[i] * dt;
          particlePool.vy[i] += gravity * dt;
          particlePool.vx[i] *= damping;
          particlePool.vy[i] *= damping;

          // Life update
          const elapsed = now - particlePool.startTime[i];
          const lifeRatio = elapsed / particlePool.maxLife[i];
          particlePool.life[i] = particlePool.maxLife[i] * (1 - lifeRatio);
          particlePool.size[i] =
            particlePool.maxSize[i] * (1 - lifeRatio * 0.8);
        }
      }

      function updateAnimations(): void {
        const now = performance.now();
        const toDelete: number[] = [];

        for (const [bodyId, anim] of state.animations) {
          const elapsed = now - anim.startTime;

          if (elapsed >= anim.duration) {
            toDelete.push(bodyId);
            continue;
          }

          const progress = elapsed / anim.duration;
          const eased = 1 - Math.pow(1 - progress, 3);

          if (anim.type === "merge") {
            const data = state.circles.get(bodyId);
            if (
              data &&
              anim.targetX !== undefined &&
              anim.targetY !== undefined &&
              anim.startX !== undefined &&
              anim.startY !== undefined
            ) {
              const currentX =
                anim.startX + (anim.targetX - anim.startX) * eased;
              const currentY =
                anim.startY + (anim.targetY - anim.startY) * eased;
              Body.setPosition(data.body, { x: currentX, y: currentY });
            }
          } else if (anim.type === "spawn") {
            anim.scale = eased;
          }
        }

        toDelete.forEach((id) => state.animations.delete(id));
      }

      // Fast danger line check
      function updateHighestCircle(): void {
        state.highestCircleTop = cfg.boardH;
        for (const data of state.circles.values()) {
          const radius = cfg.getRadiusForValue(data.value);
          const top = data.body.position.y - radius;
          if (top < state.highestCircleTop) {
            state.highestCircleTop = top;
          }
        }
      }

      function checkDangerLine(): void {
        if (state.highestCircleTop > cfg.dangerLineY) return; // Fast path

        const now = performance.now();
        for (const data of state.circles.values()) {
          const age = now - data.bornAt;
          if (age <= cfg.gracePeriodMs) continue;

          const circleRadius = cfg.getRadiusForValue(data.value);
          const top = data.body.position.y - circleRadius;

          if (top < cfg.dangerLineY || data.body.position.y < cfg.dangerLineY) {
            endGame("Danger line crossed.");
            return;
          }
        }

        // Emergency check
        if (state.circles.size > 12) {
          let emergencyCount = 0;
          for (const data of state.circles.values()) {
            const age = now - data.bornAt;
            if (
              age > cfg.gracePeriodMs &&
              data.body.position.y < cfg.dangerLineY + 30
            ) {
              emergencyCount++;
            }
          }
          if (emergencyCount > 6) {
            endGame("Too many circles stacked.");
            return;
          }
        }
      }

      // Drawing functions with sprite cache
      function drawCircle(
        x: number,
        y: number,
        value: number,
        bodyId: number
      ): void {
        const baseRadius = cfg.getRadiusForValue(value);
        let r = baseRadius;

        const anim = state.animations.get(bodyId);
        if (anim && anim.type === "spawn") {
          r = baseRadius * (anim.scale || 0);
          if (r < 1) return;
        }

        // Use cached sprite
        const sprite = spriteCache.getSprite(value, r, dpr);
        const spriteSize = sprite.width / dpr;

        ctx.drawImage(
          sprite,
          x - spriteSize / 2,
          y - spriteSize / 2,
          spriteSize,
          spriteSize
        );
      }

      // Optimized particle rendering with batching
      function drawParticles(): void {
        const targetFPS = stepRunner.getTargetFPS();

        // Reduce particle rendering complexity at high FPS
        const useSimpleRendering = targetFPS >= 144;

        for (let i = 0; i < particlePool.getCapacity(); i++) {
          if (particlePool.life[i] <= 0 || particlePool.size[i] <= 0) continue;

          const alpha = Math.max(
            0,
            particlePool.life[i] / particlePool.maxLife[i]
          );
          const color = spriteCache.getColor(particlePool.colorIndex[i]);

          if (useSimpleRendering) {
            // Simplified rendering for ultra-high FPS
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(
              particlePool.x[i],
              particlePool.y[i],
              particlePool.size[i],
              0,
              Math.PI * 2
            );
            ctx.fill();
          } else {
            // Full quality rendering for standard FPS
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowColor = color;
            ctx.shadowBlur = particlePool.size[i] * 2;
            ctx.beginPath();
            ctx.arc(
              particlePool.x[i],
              particlePool.y[i],
              particlePool.size[i],
              0,
              Math.PI * 2
            );
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
          }
        }

        // Reset global alpha if using simple rendering
        if (useSimpleRendering) {
          ctx.globalAlpha = 1;
        }
      }

      // Performance monitoring and FPS display
      const DEBUG_MODE = false; // Set to true for performance monitoring
      function drawPerformanceInfo(): void {
        if (!DEBUG_MODE) return;

        const currentFPS = stepRunner.getCurrentFPS();
        const targetFPS = stepRunner.getTargetFPS();

        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(10, 10, 200, 80);

        ctx.fillStyle = "#00ff00";
        ctx.font = "14px monospace";
        ctx.fillText(`FPS: ${currentFPS}/${targetFPS}`, 20, 30);
        ctx.fillText(`Circles: ${state.circles.size}`, 20, 50);
        ctx.fillText(`Particles: ${particlePool.getActiveCount()}`, 20, 70);
        ctx.fillText(`Sprites: ${spriteCache.size()}`, 20, 90);
        ctx.restore();
      }

      // Optimized draw function for high FPS
      let lastDrawTime = 0;
      let frameSkipCounter = 0;
      const targetFrameTime = 1000 / stepRunner.getTargetFPS();

      function draw(): void {
        const now = performance.now();

        // Adaptive frame skipping for consistent performance
        if (
          now - lastDrawTime < targetFrameTime * 0.8 &&
          stepRunner.getCurrentFPS() > stepRunner.getTargetFPS() * 1.1
        ) {
          frameSkipCounter++;
          if (frameSkipCounter < 2) return; // Skip max 2 frames
        }

        frameSkipCounter = 0;
        lastDrawTime = now;

        // Use willReadFrequently hint for better performance
        ctx.clearRect(0, 0, cfg.boardW, cfg.boardH);

        // Preview circle - optimized with reduced operations
        if (!state.ended && !state.paused) {
          const timeSinceLastDrop = now - state.lastDropTs;
          const canDrop = timeSinceLastDrop >= cfg.dropCooldownMs;

          if (canDrop) {
            drawOptimizedPreview(now, timeSinceLastDrop);
          }
        }

        // Danger line is handled by CSS (.danger::before and ::after)

        // Batch circle rendering for better performance
        drawAllCircles();
        drawParticles();
        drawPerformanceInfo();
      }

      // Optimized preview drawing with cached calculations
      const easeOutBackCache = new Map<number, number>();
      function getEaseOutBack(t: number): number {
        const key = Math.round(t * 100);
        if (easeOutBackCache.has(key)) {
          return easeOutBackCache.get(key)!;
        }

        const c1 = 1.70158;
        const c3 = c1 + 1;
        const result = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        easeOutBackCache.set(key, result);
        return result;
      }

      function drawOptimizedPreview(
        now: number,
        timeSinceLastDrop: number
      ): void {
        const animationDuration = 200;
        const timeSinceCanDrop = timeSinceLastDrop - cfg.dropCooldownMs;
        const animationProgress = Math.min(
          timeSinceCanDrop / animationDuration,
          1
        );

        const scale = getEaseOutBack(animationProgress);
        const alpha = 0.7 * animationProgress;

        const x = state.previewX;
        const v = state.nextValue;
        const r = cfg.getRadiusForValue(v) * scale;
        const y = cfg.spawnY;
        const fill = spriteCache.getColor(spriteCache.getColorIndex(v));

        // Reduced canvas state changes
        const oldAlpha = ctx.globalAlpha;
        const oldShadowColor = ctx.shadowColor;
        const oldShadowBlur = ctx.shadowBlur;
        const oldLineWidth = ctx.lineWidth;
        const oldStrokeStyle = ctx.strokeStyle;

        ctx.globalAlpha = alpha;
        ctx.shadowColor = fill;
        ctx.shadowBlur = 16 * scale;

        // Draw main circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Draw border
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3 * scale;
        ctx.strokeStyle = "rgba(255,255,255,.22)";
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r - 3 * scale), 0, Math.PI * 2);
        ctx.stroke();

        // Text with animation (only when needed)
        if (animationProgress > 0.5) {
          const textAlpha = (animationProgress - 0.5) * 2;
          const pulse = 0.95 + 0.05 * Math.sin(now * 0.003);
          ctx.globalAlpha = alpha * textAlpha;
          ctx.fillStyle = "#0b0e15";
          const fontSize = Math.max(10, 18 * (r / cfg.radius));
          ctx.font = `bold ${fontSize * pulse}px Inter, ui-sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(v), x, y);
        }

        // Restore state efficiently
        ctx.globalAlpha = oldAlpha;
        ctx.shadowColor = oldShadowColor;
        ctx.shadowBlur = oldShadowBlur;
        ctx.lineWidth = oldLineWidth;
        ctx.strokeStyle = oldStrokeStyle;
      }

      // Batched circle rendering
      function drawAllCircles(): void {
        // Sort circles by depth for better rendering
        const sortedCircles = Array.from(state.circles.values()).sort(
          (a, b) => a.body.position.y - b.body.position.y
        );

        for (const data of sortedCircles) {
          drawCircle(
            data.body.position.x,
            data.body.position.y,
            data.value,
            data.body.id
          );
        }
      }

      // High-FPS optimized pointer input handling
      function updatePreviewFromClientX(clientX: number): void {
        const now = performance.now();
        // Adaptive throttling based on target FPS
        const throttleMs = Math.max(4, 1000 / (stepRunner.getTargetFPS() * 2)); // 2x input rate vs display
        if (now - state.previewUpdateTime < throttleMs) return;
        state.previewUpdateTime = now;

        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) * (cfg.boardW / rect.width);
        const previewRadius = cfg.getRadiusForValue(state.nextValue);
        state.previewX = Math.max(
          previewRadius,
          Math.min(cfg.boardW - previewRadius, x)
        );
      }

      function isSpawnFree(
        x: number,
        y: number,
        value = state.nextValue
      ): boolean {
        const spawnRadius = cfg.getRadiusForValue(value);

        for (const data of state.circles.values()) {
          const dx = x - data.body.position.x;
          const dy = y - data.body.position.y;
          const existingRadius = cfg.getRadiusForValue(data.value);
          const minDistance = (spawnRadius + existingRadius) * 1.1;
          if (Math.hypot(dx, dy) < minDistance) return false;
        }

        return (
          y >= spawnRadius &&
          y <= cfg.boardH - spawnRadius &&
          x >= spawnRadius &&
          x <= cfg.boardW - spawnRadius
        );
      }

      function tryDrop(): void {
        if (!state.running || state.ended || state.paused) return;
        const now = performance.now();
        if (now - state.lastDropTs < cfg.dropCooldownMs) return;

        const value = state.nextValue;
        const radius = cfg.getRadiusForValue(value);
        let x = state.previewX;
        let y = cfg.spawnY;

        if (!isSpawnFree(x, y, value)) {
          const step = radius * 1.1;
          let placed = false;

          for (let i = 1; i <= 6; i++) {
            const xl = x - i * step;
            const xr = x + i * step;
            if (xl >= radius && isSpawnFree(xl, y, value)) {
              x = xl;
              placed = true;
              break;
            }
            if (xr <= cfg.boardW - radius && isSpawnFree(xr, y, value)) {
              x = xr;
              placed = true;
              break;
            }
          }

          if (!placed) {
            const safeY = cfg.spawnY;
            for (let i = 0; i <= 6; i++) {
              const testX =
                state.previewX +
                (i % 2 === 0 ? 1 : -1) * Math.floor(i / 2) * step;
              if (
                testX >= radius &&
                testX <= cfg.boardW - radius &&
                isSpawnFree(testX, safeY, value)
              ) {
                x = testX;
                y = safeY;
                placed = true;
                break;
              }
            }
          }

          if (!placed) {
            endGame("No space to spawn.");
            return;
          }
        }

        const C = createCircle(x, y, value);
        if (C) {
          state.nextValue = rollValue();
          store.setState({ nextValue: state.nextValue });
          state.lastDropTs = now;
        }
      }

      // Game control
      function endGame(reason: string): void {
        if (state.ended) return;

        state.ended = true;
        state.running = false;
        state.endReason = reason;
        engine.timing.timeScale = 0;

        store.setState({
          ended: true,
          running: false,
          endReason: reason,
        });
        setShowModal(true);
      }

      function restart(): void {
        engine.timing.timeScale = 0;
        for (const data of Array.from(state.circles.values())) {
          try {
            World.remove(engine.world, data.body);
          } catch {}
        }
        state.circles.clear();
        state.mergingCircles.clear();
        state.animations.clear();
        state.mergeQueue.length = 0;
        particlePool.clear();
        stepRunner.reset();

        state.score = 0;
        state.nextValue = rollValue();
        state.running = true;
        state.paused = false;
        state.ended = false;
        state.endReason = "";
        state.lastDropTs = 0;
        state.previewX = cfg.boardW / 2;
        state.nextLocalId = 1;
        state.highestCircleTop = cfg.boardH;

        store.setState({
          score: 0,
          best: state.best,
          nextValue: state.nextValue,
          running: true,
          paused: false,
          ended: false,
          endReason: "",
        });
        setShowModal(false);

        setTimeout(() => {
          engine.timing.timeScale = 1;
        }, 30);
        showToastMessage("New game started");
      }

      function togglePause(): void {
        if (state.ended) return;
        state.paused = !state.paused;
        engine.timing.timeScale = state.paused ? 0 : 1;

        store.setState({ paused: state.paused });
        showToastMessage(state.paused ? "Paused" : "Resumed");
      }

      // Unified pointer events
      let isPointerDown = false;
      let pointerStartX = 0;
      let pointerStartY = 0;

      function handlePointerStart(e: PointerEvent): void {
        e.preventDefault();
        isPointerDown = true;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        updatePreviewFromClientX(e.clientX);
      }

      function handlePointerMove(e: PointerEvent): void {
        if (!isPointerDown || state.ended || state.paused) return;
        e.preventDefault();

        const deltaX = Math.abs(e.clientX - pointerStartX);
        const deltaY = Math.abs(e.clientY - pointerStartY);

        if (deltaX > deltaY || deltaY < 20) {
          updatePreviewFromClientX(e.clientX);
        }
      }

      function handlePointerEnd(e: PointerEvent): void {
        if (!isPointerDown) return;
        e.preventDefault();
        isPointerDown = false;

        const deltaX = Math.abs(e.clientX - pointerStartX);
        const deltaY = Math.abs(e.clientY - pointerStartY);

        if (deltaX < 10 && deltaY < 10) {
          updatePreviewFromClientX(e.clientX);
          tryDrop();
        }
      }

      function handlePointerCancel(e: PointerEvent): void {
        isPointerDown = false;
      }

      // Add pointer event listeners
      canvas.addEventListener("pointerdown", handlePointerStart, {
        passive: false,
      });
      canvas.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      canvas.addEventListener("pointerup", handlePointerEnd, {
        passive: false,
      });
      canvas.addEventListener("pointercancel", handlePointerCancel, {
        passive: false,
      });

      // Resize handling with ResizeObserver
      function handleResize(): void {
        const newDimensions = calculateBoardDimensions();

        dynamicBoardW = newDimensions.dynamicBoardW;
        dynamicBoardH = newDimensions.dynamicBoardH;
        isMobile = newDimensions.isMobile;

        cfg.boardW = newDimensions.dynamicBoardW;
        cfg.boardH = newDimensions.dynamicBoardH;

        const newDpr = newDimensions.isMobile
          ? Math.max(1, Math.min(1.5, window.devicePixelRatio || 1))
          : Math.max(1, Math.min(2, window.devicePixelRatio || 1));

        canvas.width = cfg.boardW * newDpr;
        canvas.height = cfg.boardH * newDpr;
        canvas.style.width = cfg.boardW + "px";
        canvas.style.height = cfg.boardH + "px";
        ctx.setTransform(newDpr, 0, 0, newDpr, 0, 0);

        // Clear sprite cache on resize
        spriteCache.clear();

        // Update walls
        if (walls) {
          World.remove(engine.world, walls);
        }

        const WALL_THICK_RESIZE = cfg.radius * 2;
        walls = [
          Bodies.rectangle(
            -WALL_THICK_RESIZE / 2,
            cfg.boardH / 2,
            WALL_THICK_RESIZE,
            cfg.boardH + WALL_THICK_RESIZE,
            {
              isStatic: true,
              label: "wall",
              render: { visible: false },
            }
          ),
          Bodies.rectangle(
            cfg.boardW + WALL_THICK_RESIZE / 2,
            cfg.boardH / 2,
            WALL_THICK_RESIZE,
            cfg.boardH + WALL_THICK_RESIZE,
            {
              isStatic: true,
              label: "wall",
              render: { visible: false },
            }
          ),
          Bodies.rectangle(
            cfg.boardW / 2,
            cfg.boardH + WALL_THICK_RESIZE / 2,
            cfg.boardW + WALL_THICK_RESIZE * 2,
            WALL_THICK_RESIZE,
            {
              isStatic: true,
              label: "floor",
              render: { visible: false },
            }
          ),
          Bodies.rectangle(
            cfg.boardW / 2,
            -WALL_THICK_RESIZE,
            cfg.boardW + WALL_THICK_RESIZE * 2,
            WALL_THICK_RESIZE,
            {
              isStatic: true,
              label: "ceiling",
              render: { visible: false },
            }
          ),
        ];
        World.add(engine.world, walls);
      }

      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(stageBoard);

      // Fixed timestep game loop
      function gameStep(): void {
        stepRunner.update(performance.now(), (fixedDt) => {
          if (state.running && !state.paused) {
            Engine.update(engine, fixedDt);
            processMergeQueue(); // Process merges after physics
            updateHighestCircle();
            checkDangerLine();
          }
        });

        updateParticles();
        updateAnimations();
        draw();

        rafId = requestAnimationFrame(gameStep);
      }

      // Store game functions for external access
      gameInstanceRef.current = {
        restart,
        togglePause,
        state,
        cleanup: () => {
          if (rafId) cancelAnimationFrame(rafId);
          if (resizeObserver) resizeObserver.disconnect();

          canvas.removeEventListener("pointerdown", handlePointerStart);
          canvas.removeEventListener("pointermove", handlePointerMove);
          canvas.removeEventListener("pointerup", handlePointerEnd);
          canvas.removeEventListener("pointercancel", handlePointerCancel);

          Events.off(engine, "collisionStart");
          World.clear(engine.world, false);
          Engine.clear(engine);

          particlePool.clear();
          spriteCache.clear();

          state.circles.clear();
          state.mergingCircles.clear();
          state.animations.clear();
          state.mergeQueue.length = 0;
        },
      };

      restart();
      gameStep();
    };

    initGame();

    // Cleanup function
    return () => {
      if (gameInstanceRef.current?.cleanup) {
        gameInstanceRef.current.cleanup();
      }
    };
  }, []);

  const formatNumber = (num: number): string => {
    if (num < 1000) {
      return num.toString();
    }

    const thousands = num / 1000;

    if (thousands % 1 === 0) {
      return `${Math.floor(thousands)}k`;
    } else {
      return `${thousands.toFixed(1).replace(/\.?0+$/, "")}k`;
    }
  };

  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 1200);
  };

  const handlePause = () => {
    if (gameInstanceRef.current) {
      gameInstanceRef.current.togglePause();
    }
  };

  const handleRestart = () => {
    if (gameInstanceRef.current) {
      gameInstanceRef.current.restart();
    }
  };

  return (
    <div className="hero">
      <div className="hero__bg"></div>
      <div className="hero__wrap">
        <div className="hero__bar" aria-hidden="true"></div>

        <section className="glass card card--stage">
          <h1 className="game__title">S U O K A</h1>
          <div className="stage__hud">
            <div className="hud__group">
              <div className="hud__chip">
                <span>Score</span>
                <strong>{formatNumber(gameState.score)}</strong>
              </div>
              <div className="hud__chip">
                <span>Best</span>
                <strong>{formatNumber(gameState.best)}</strong>
              </div>
            </div>
            <div className="hud__actions">
              <button
                onClick={handlePause}
                className="btn btn--ghost"
                aria-pressed={gameState.paused ? "true" : "false"}
              >
                {gameState.paused ? "Resume" : "Pause"}
              </button>
              <button onClick={handleRestart} className="btn btn--light">
                Restart
              </button>
            </div>
          </div>

          <div className="stage__board" ref={stageBoardRef}>
            <div className="danger" aria-hidden="true">
              <span>DANGER</span>
            </div>
            <canvas
              ref={canvasRef}
              aria-label="SUOKA board"
              style={{ touchAction: "none" }}
            />
          </div>
        </section>

        {/* Toast */}
        <div
          className={`toast ${showToast ? "show" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toastMessage}
        </div>

        {/* Game Over Modal */}
        {showModal && (
          <div className="modal">
            <div className="modal__card glass">
              <h2>Game Over</h2>
              <p>{gameState.endReason}</p>
              <p>
                <strong>Final score:</strong> {formatNumber(gameState.score)}
              </p>
              <button onClick={handleRestart} className="btn btn--light">
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/*
CSS Note: Add the following to your global CSS if not already present:
canvas {
  touch-action: none;
}
*/
