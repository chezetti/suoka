"use client";

import { useEffect, useRef, useState } from "react";

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

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  maxSize: number;
  color: string;
  life: number;
  maxLife: number;
  startTime: number;
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
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    best: 0,
    nextValue: 2,
    running: false,
    paused: false,
    ended: false,
    endReason: "",
  });
  const [showModal, setShowModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const gameInstanceRef = useRef<any>(null);

  // Initialize game when component mounts
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Load best score from localStorage on client side
    const savedBest = Number(localStorage.getItem("circle2048.best") || 0);
    setGameState((prev) => ({ ...prev, best: savedBest }));

    const initGame = async () => {
      // Import Matter.js dynamically to avoid SSR issues
      const Matter = await import("matter-js");
      const { Engine, World, Bodies, Body, Events, Vector } = Matter;

      if (!canvasRef.current || !stageBoardRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d")!;
      const stageBoard = stageBoardRef.current;

      // Calculate board dimensions dynamically
      function calculateBoardDimensions() {
        const boardRect = stageBoard.getBoundingClientRect();
        const isMobile = window.innerWidth <= 768;

        // Get actual computed styles to read the real padding
        const computedStyle = window.getComputedStyle(stageBoard);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

        const totalHorizontalPadding = paddingLeft + paddingRight;
        const totalVerticalPadding = paddingTop + paddingBottom;

        // Account for border if any
        const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
        const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
        const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
        const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;

        const totalHorizontalBorder = borderLeft + borderRight;
        const totalVerticalBorder = borderTop + borderBottom;

        // Calculate available space for canvas
        let dynamicBoardW = Math.floor(
          boardRect.width - totalHorizontalPadding - totalHorizontalBorder
        );
        let dynamicBoardH = Math.floor(
          boardRect.height - totalVerticalPadding - totalVerticalBorder
        );

        // Ensure minimum and maximum sizes but respect container bounds
        if (isMobile) {
          dynamicBoardW = Math.max(280, Math.min(dynamicBoardW, 800));
          dynamicBoardH = Math.max(400, Math.min(dynamicBoardH, 1000));
        } else {
          dynamicBoardW = Math.max(500, Math.min(dynamicBoardW, 1200));
          // Don't use fixed height - respect container bounds
          dynamicBoardH = Math.max(500, Math.min(dynamicBoardH, 1000));
        }

        return { dynamicBoardW, dynamicBoardH, isMobile };
      }

      let { dynamicBoardW, dynamicBoardH, isMobile } =
        calculateBoardDimensions();

      // Function to calculate radius based on value and screen size
      function getRadiusForValue(value: number): number {
        // Calculate adaptive base radius based on field size
        const minDimension = Math.min(dynamicBoardW, dynamicBoardH);
        let baseRadius: number;

        if (isMobile) {
          // Mobile: scale based on field size, smaller for small screens
          baseRadius = Math.max(16, Math.min(32, minDimension * 0.08));
        } else {
          // Desktop: standard sizing
          baseRadius = 34;
        }

        const scaleFactor = Math.log2(value / 2) * 0.15; // Logarithmic scaling
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
          // Adaptive base radius for calculations
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
          // Calculate spawn position based on the largest possible circle that could spawn
          const maxSpawnValue = 32; // Largest value from valueDist array
          const maxRadius = getRadiusForValue(maxSpawnValue);
          // Ensure spawn is well above danger line and within canvas bounds
          const minSpawnY = maxRadius;
          const dangerOffset = maxRadius + 120; // Increased from 80 to 120px clearance from danger line
          const calculatedY = Math.max(
            minSpawnY,
            this.dangerLineY - dangerOffset
          );

          return calculatedY;
        },
        gracePeriodMs: 800,
        dropCooldownMs: 140,

        // Physics
        gravity: 1.0,
        restitution: 0.08,
        friction: 0.25,
        frictionStatic: 0.55,
        frictionAir: 0.01,
        sleepThreshold: 60,
        maxVelocity: 900,
        maxCircles: 150,

        // Merge thresholds (instant merging)
        mergeSpeedMax: 200,
        mergeRelSpeedMax: 300,

        // Spawn value distribution
        valueDist: [2, 2, 2, 2, 2, 4, 4, 8, 16, 32],
        scoreMul: 1,
      };

      // Canvas setup with mobile optimization
      // Lower DPR on mobile for better performance
      const baseDpr = window.devicePixelRatio || 1;
      const dpr = isMobile
        ? Math.max(1, Math.min(1.5, baseDpr))
        : Math.max(1, Math.min(2, baseDpr));

      canvas.width = cfg.boardW * dpr;
      canvas.height = cfg.boardH * dpr;
      canvas.style.width = cfg.boardW + "px";
      canvas.style.height = cfg.boardH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Mobile-specific canvas optimizations
      if (isMobile) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
      }

      // Neon Liquid Glass Color Mapping
      const colorMap: { [key: number]: string } = {
        2: "#c7d2fe", // lavender glow
        4: "#a78bfa", // violet
        8: "#60a5fa", // blue
        16: "#67e8f9", // cyan
        32: "#34d399", // emerald
        64: "#facc15", // yellow
        128: "#f97316", // orange
        256: "#ef4444", // red
        512: "#ec4899", // pink
        1024: "#d946ef", // magenta
        2048: "#a855f7", // bright purple
        4096: "#8b5cf6", // deep purple
        8192: "#7c3aed", // royal purple
      };
      const colorForValue = (v: number) => colorMap[v] || "#ddd6fe";
      const rollValue = () =>
        cfg.valueDist[Math.floor(Math.random() * cfg.valueDist.length)];

      // Physics engine
      const engine = Engine.create({ enableSleeping: true });
      engine.world.gravity.y = cfg.gravity;
      engine.velocityIterations = 6;
      engine.positionIterations = 6;

      // Walls - improved positioning
      const WALL_THICK = cfg.radius * 2; // Make walls thicker
      let walls = [
        // Left wall
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
        // Right wall
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
        // Bottom wall - positioned to prevent circles from falling out
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
        // Top invisible wall to catch any stray circles
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
        lastDropTs: 0,
        ended: false,
        endReason: "",
        circles: new Map(),
        nextLocalId: 1,
        mergingCircles: new Set(),
        particles: [] as Particle[],
        animations: new Map(),
      };

      // Update React state
      setGameState({
        score: state.score,
        best: state.best,
        nextValue: state.nextValue,
        running: state.running,
        paused: state.paused,
        ended: state.ended,
        endReason: state.endReason,
      });

      // Create circle function
      function createCircle(x: number, y: number, value: number) {
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
        const data = {
          body,
          value,
          bornAt: performance.now(),
          id: state.nextLocalId++,
        };
        state.circles.set(body.id, data);
        return data;
      }

      // Remove circle function
      function removeCircle(bodyId: number) {
        const data = state.circles.get(bodyId);
        if (!data) return;
        try {
          World.remove(engine.world, data.body);
        } catch {}
        state.circles.delete(bodyId);
        state.mergingCircles.delete(bodyId);
      }

      // Collision handling for instant merge
      Events.on(engine, "collisionStart", ({ pairs }) => {
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
            performMerge(A, B);
          }
        }
      });

      // Merge function
      function performMerge(A: any, B: any) {
        if (!state.circles.has(A.body.id) || !state.circles.has(B.body.id))
          return;
        if (
          state.mergingCircles.has(A.body.id) ||
          state.mergingCircles.has(B.body.id)
        )
          return;

        state.mergingCircles.add(A.body.id);
        state.mergingCircles.add(B.body.id);

        const x = (A.body.position.x + B.body.position.x) / 2;
        const y = (A.body.position.y + B.body.position.y) / 2;
        const newValue = A.value * 2;

        createMergeExplosion(
          x,
          y,
          colorForValue(A.value),
          colorForValue(newValue),
          A.value
        );

        state.animations.set(A.body.id, {
          startTime: performance.now(),
          duration: 300,
          type: "merge",
          targetX: x,
          targetY: y,
          startX: A.body.position.x,
          startY: A.body.position.y,
        });
        state.animations.set(B.body.id, {
          startTime: performance.now(),
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
          localStorage.setItem("circle2048.best", String(state.best));
        }

        // Update React state
        setGameState((prev) => ({
          ...prev,
          score: state.score,
          best: state.best,
        }));

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
        oldColor: string,
        newColor: string,
        circleValue: number = 2
      ) {
        const particleCount = 8 + Math.floor(Math.random() * 4);
        const circleRadius = cfg.getRadiusForValue(circleValue);
        const sizeMultiplier = circleRadius / cfg.radius; // Scale particles with circle size

        for (let i = 0; i < particleCount; i++) {
          const angle =
            (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
          const speed = (80 + Math.random() * 40) * sizeMultiplier;
          const size = (3 + Math.random() * 4) * sizeMultiplier;
          const life = 600 + Math.random() * 300;

          state.particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size,
            maxSize: size,
            color: Math.random() > 0.5 ? oldColor : newColor,
            life,
            maxLife: life,
            startTime: performance.now(),
          } as Particle);
        }
      }

      function updateParticles() {
        const now = performance.now();

        for (let i = state.particles.length - 1; i >= 0; i--) {
          const p = state.particles[i];
          const elapsed = now - p.startTime;

          if (elapsed >= p.maxLife) {
            state.particles.splice(i, 1);
            continue;
          }

          p.x += p.vx * 0.016;
          p.y += p.vy * 0.016;
          p.vy += 200 * 0.016;
          p.vx *= 0.98;
          p.vy *= 0.98;

          const lifeRatio = elapsed / p.maxLife;
          p.life = p.maxLife * (1 - lifeRatio);
          p.size = p.maxSize * (1 - lifeRatio * 0.8);
        }
      }

      function updateAnimations() {
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
            if (data) {
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

      // Drawing functions
      function drawCircle(x: number, y: number, value: number, bodyId: number) {
        const baseRadius = cfg.getRadiusForValue(value);
        let r = baseRadius;
        let actualX = x,
          actualY = y;

        const anim = state.animations.get(bodyId);
        if (anim && anim.type === "spawn") {
          r = baseRadius * anim.scale;
          if (r < 1) return;
        }

        const fill = colorForValue(value);
        ctx.save();

        // Liquid neon marble effects - subtle but color-matched glow
        const glowMultiplier =
          anim && anim.type === "spawn" ? 1 + anim.scale : 1;
        const glowIntensity = 12 * glowMultiplier;

        // Outer neon glow - matching fill color
        ctx.shadowColor = fill;
        ctx.shadowBlur = glowIntensity;
        ctx.globalCompositeOperation = "source-over";

        // Main circle body
        ctx.beginPath();
        ctx.arc(actualX, actualY, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Reset shadow for inner elements
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";

        // Inner shadow for depth
        const innerShadowGrad = ctx.createRadialGradient(
          actualX,
          actualY,
          r * 0.7,
          actualX,
          actualY,
          r
        );
        innerShadowGrad.addColorStop(0, "rgba(0,0,0,0)");
        innerShadowGrad.addColorStop(1, "rgba(0,0,0,0.3)");
        ctx.beginPath();
        ctx.arc(actualX, actualY, r, 0, Math.PI * 2);
        ctx.fillStyle = innerShadowGrad;
        ctx.fill();

        // Inner ring stroke - semi-transparent white
        ctx.lineWidth = Math.max(1, 3 * (r / baseRadius));
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.arc(actualX, actualY, Math.max(1, r - 2), 0, Math.PI * 2);
        ctx.stroke();

        // Inner glass highlight at top-left
        const highlightGrad = ctx.createRadialGradient(
          actualX - r * 0.3,
          actualY - r * 0.4,
          0,
          actualX - r * 0.3,
          actualY - r * 0.4,
          r * 0.6
        );
        highlightGrad.addColorStop(0, "rgba(255,255,255,0.25)");
        highlightGrad.addColorStop(0.3, "rgba(255,255,255,0.15)");
        highlightGrad.addColorStop(1, "rgba(255,255,255,0)");

        ctx.beginPath();
        ctx.arc(actualX, actualY, Math.max(1, r - 1), 0, Math.PI * 2);
        ctx.fillStyle = highlightGrad;
        ctx.fill();

        // Glowing text with neon effect
        if (r > baseRadius * 0.3) {
          const fontSize = Math.max(10, 18 * (r / baseRadius));
          ctx.font = `bold ${fontSize}px 'Inter Tight', Inter, ui-sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          // Text glow
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "#ffffff";
          ctx.fillText(String(value), actualX, actualY);

          // Additional text glow
          ctx.shadowBlur = 4;
          ctx.fillStyle = "#f8fafc";
          ctx.fillText(String(value), actualX, actualY);
        }

        ctx.restore();
      }

      function drawParticles() {
        for (const p of state.particles) {
          if (p.life <= 0 || p.size <= 0) continue;

          ctx.save();
          const alpha = Math.max(0, p.life / p.maxLife);
          ctx.globalAlpha = alpha;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = p.size * 2;

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
        }
      }

      function draw() {
        ctx.clearRect(0, 0, cfg.boardW, cfg.boardH);

        // Preview circle
        if (!state.ended && !state.paused) {
          const x = state.previewX;
          const v = state.nextValue;
          const r = cfg.getRadiusForValue(v);
          // Use the same spawn Y logic as actual spawning
          const y = cfg.spawnY;
          const fill = colorForValue(v);

          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.shadowColor = fill;
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,.22)";
          ctx.beginPath();
          ctx.arc(x, y, r - 3, 0, Math.PI * 2);
          ctx.stroke();

          const pulse = 0.95 + 0.05 * Math.sin(performance.now() * 0.003);
          ctx.fillStyle = "#0b0e15";
          const fontSize = Math.max(10, 18 * (r / cfg.radius));
          ctx.font = `bold ${fontSize * pulse}px Inter, ui-sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(v), x, y);
          ctx.restore();
        }

        // All circles
        for (const data of state.circles.values()) {
          drawCircle(
            data.body.position.x,
            data.body.position.y,
            data.value,
            data.body.id
          );
        }

        drawParticles();
      }

      // Input handling
      function updatePreviewFromClientX(clientX: number) {
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
        value: number = state.nextValue
      ) {
        const spawnRadius = cfg.getRadiusForValue(value);

        for (const data of state.circles.values()) {
          const dx = x - data.body.position.x;
          const dy = y - data.body.position.y;
          const existingRadius = cfg.getRadiusForValue(data.value);
          const minDistance = (spawnRadius + existingRadius) * 1.1; // Small buffer
          if (Math.hypot(dx, dy) < minDistance) return false;
        }

        if (y < spawnRadius || y > cfg.boardH - spawnRadius) return false;
        if (x < spawnRadius || x > cfg.boardW - spawnRadius) return false;

        return true;
      }

      function tryDrop() {
        if (!state.running || state.ended || state.paused) return;
        const now = performance.now();
        if (now - state.lastDropTs < cfg.dropCooldownMs) return;

        const value = state.nextValue;
        const radius = cfg.getRadiusForValue(value);

        let x = state.previewX;
        // Use the same spawn Y logic as preview and cfg
        let y = cfg.spawnY;

        if (!isSpawnFree(x, y, value)) {
          const step = radius * 1.1;
          let placed = false;

          for (let i = 1; i <= 6; i++) {
            const xl = x - i * step,
              xr = x + i * step;
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
            // Use the same spawn Y as configured, don't go higher
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
          setGameState((prev) => ({ ...prev, nextValue: state.nextValue }));
          state.lastDropTs = now;
        }
      }

      // Game control
      function checkDangerLine() {
        const now = performance.now();

        // Note: danger line detection with triple safety checks

        for (const data of state.circles.values()) {
          const circleRadius = cfg.getRadiusForValue(data.value);
          const top = data.body.position.y - circleRadius;
          const age = now - data.bornAt;

          // Check if circle crosses danger line

          if (age > cfg.gracePeriodMs && top < cfg.dangerLineY) {
            endGame("Danger line crossed.");
            return;
          }

          // Additional safety check: circle center crossed danger line (more strict)
          if (
            age > cfg.gracePeriodMs &&
            data.body.position.y < cfg.dangerLineY
          ) {
            console.log(
              `GAME OVER (strict): Circle ${
                data.value
              } center crossed danger line! center=${data.body.position.y.toFixed(
                1
              )}, danger=${cfg.dangerLineY}`
            );
            endGame("Danger line crossed.");
            return;
          }
        }

        // Emergency check: if there are many circles and some are clearly above danger line
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
            console.log(
              `EMERGENCY GAME OVER: ${emergencyCount} circles above danger zone`
            );
            endGame("Too many circles stacked.");
            return;
          }
        }
      }

      function endGame(reason: string) {
        if (state.ended) return;

        state.ended = true;
        state.running = false;
        state.endReason = reason;
        engine.timing.timeScale = 0;

        setGameState((prev) => ({
          ...prev,
          ended: true,
          running: false,
          endReason: reason,
        }));
        setShowModal(true);
      }

      function restart() {
        engine.timing.timeScale = 0;
        for (const data of Array.from(state.circles.values())) {
          try {
            World.remove(engine.world, data.body);
          } catch {}
        }
        state.circles.clear();
        state.mergingCircles.clear();
        state.particles.length = 0;
        state.animations.clear();

        state.score = 0;
        state.nextValue = rollValue();
        state.running = true;
        state.paused = false;
        state.ended = false;
        state.endReason = "";
        state.lastDropTs = 0;
        state.previewX = cfg.boardW / 2;
        state.nextLocalId = 1;

        setGameState({
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

      function togglePause() {
        if (state.ended) return;
        state.paused = !state.paused;
        engine.timing.timeScale = state.paused ? 0 : 1;

        setGameState((prev) => ({ ...prev, paused: state.paused }));
        showToastMessage(state.paused ? "Paused" : "Resumed");
      }

      // Enhanced event listeners for mobile
      let lastTouchTime = 0;
      let touchStartX = 0;
      let touchStartY = 0;

      // Prevent zoom on double tap
      canvas.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();

          const now = Date.now();
          const timeSinceLastTouch = now - lastTouchTime;
          lastTouchTime = now;

          const t = e.touches[0];
          if (!t) return;

          touchStartX = t.clientX;
          touchStartY = t.clientY;

          // Prevent double tap zoom
          if (timeSinceLastTouch < 300) {
            e.preventDefault();
            return;
          }

          if (t) updatePreviewFromClientX(t.clientX);
        },
        { passive: false }
      );

      canvas.addEventListener(
        "touchmove",
        (e) => {
          e.preventDefault();
          if (state.ended || state.paused) return;

          const t = e.touches[0];
          if (!t) return;

          // Only update preview if moving horizontally
          const deltaX = Math.abs(t.clientX - touchStartX);
          const deltaY = Math.abs(t.clientY - touchStartY);

          if (deltaX > deltaY || deltaY < 20) {
            updatePreviewFromClientX(t.clientX);
          }
        },
        { passive: false }
      );

      canvas.addEventListener(
        "touchend",
        (e) => {
          e.preventDefault();

          const t = e.changedTouches[0];
          if (!t) return;

          // Check if it's a tap (not a drag)
          const deltaX = Math.abs(t.clientX - touchStartX);
          const deltaY = Math.abs(t.clientY - touchStartY);

          if (deltaX < 10 && deltaY < 10) {
            updatePreviewFromClientX(t.clientX);
            tryDrop();
          }
        },
        { passive: false }
      );

      // Mouse events for desktop
      canvas.addEventListener("mousemove", (e) => {
        if (state.ended || state.paused) return;
        // Only respond to mouse if not on touch device
        if ("ontouchstart" in window) return;
        updatePreviewFromClientX(e.clientX);
      });

      canvas.addEventListener("click", (e) => {
        // Only respond to mouse if not on touch device
        if ("ontouchstart" in window) return;
        updatePreviewFromClientX(e.clientX);
        tryDrop();
      });

      // Handle window resize
      function handleResize() {
        const newDimensions = calculateBoardDimensions();

        // Update dimensions variables for getRadiusForValue function
        dynamicBoardW = newDimensions.dynamicBoardW;
        dynamicBoardH = newDimensions.dynamicBoardH;
        isMobile = newDimensions.isMobile;

        cfg.boardW = newDimensions.dynamicBoardW;
        cfg.boardH = newDimensions.dynamicBoardH;

        // Update canvas size
        const newDpr = newDimensions.isMobile
          ? Math.max(1, Math.min(1.5, window.devicePixelRatio || 1))
          : Math.max(1, Math.min(2, window.devicePixelRatio || 1));

        canvas.width = cfg.boardW * newDpr;
        canvas.height = cfg.boardH * newDpr;
        canvas.style.width = cfg.boardW + "px";
        canvas.style.height = cfg.boardH + "px";
        ctx.setTransform(newDpr, 0, 0, newDpr, 0, 0);

        // Update Matter.js world boundaries
        if (walls) {
          World.remove(engine.world, walls);
        }

        // Use the same wall logic as initial creation
        const WALL_THICK_RESIZE = cfg.radius * 2;
        walls = [
          // Left wall
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
          // Right wall
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
          // Bottom wall
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
          // Top wall
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

      // Add resize listener and store reference for cleanup
      if (!window._suokaListeners) {
        window._suokaListeners = {};
      }
      window._suokaListeners.handleResize = handleResize;
      window.addEventListener("resize", handleResize);

      // Main loop
      function step() {
        if (state.running && !state.paused) {
          Engine.update(engine, 1000 / 60);
          checkDangerLine();
        }

        updateParticles();
        updateAnimations();
        draw();
        requestAnimationFrame(step);
      }

      // Store game functions for external access
      gameInstanceRef.current = {
        restart,
        togglePause,
        state,
      };

      restart();
      step();
    };

    initGame();

    // Cleanup function
    return () => {
      // Cleanup will be handled by removing the listeners if they exist
      if (typeof window !== "undefined") {
        const listeners = window._suokaListeners;
        if (listeners && listeners.handleResize) {
          window.removeEventListener("resize", listeners.handleResize);
        }
      }
    };
  }, []);

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
                <strong>{gameState.score}</strong>
              </div>
              <div className="hud__chip hud__chip--best">
                <span>Best</span>
                <strong>{gameState.best}</strong>
              </div>
              <div className="hud__chip">
                <span>Next</span>
                <strong>{gameState.nextValue}</strong>
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
            <canvas ref={canvasRef} aria-label="SUOKA board" />
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
                <strong>Final score:</strong> {gameState.score}
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
