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

        // Calculate padding based on screen size
        let padding = 32; // default desktop padding
        if (isMobile) {
          if (window.innerWidth <= 480) {
            padding = 24; // phone padding (12px * 2)
          } else {
            padding = 24; // tablet padding (12px * 2)
          }
        }

        let dynamicBoardW = Math.floor(boardRect.width - padding);

        // Ensure minimum and maximum sizes
        if (isMobile) {
          dynamicBoardW = Math.max(
            280,
            Math.min(dynamicBoardW, window.innerWidth - 16)
          );
        } else {
          dynamicBoardW = Math.max(500, Math.min(dynamicBoardW, 1200));
        }

        return { dynamicBoardW, isMobile };
      }

      const { dynamicBoardW, isMobile } = calculateBoardDimensions();

      const cfg = {
        boardW: dynamicBoardW,
        boardH: 760,
        radius: 34,
        dangerLineY: 120,
        get spawnY() {
          return this.dangerLineY - this.radius - 40;
        },
        gracePeriodMs: 1500,
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

      // Color mapping
      const colorMap: { [key: number]: string } = {
        2: "#c7d2fe",
        4: "#a5b4fc",
        8: "#93c5fd",
        16: "#7dd3fc",
        32: "#6ee7f9",
        64: "#6efacc",
        128: "#a7f3d0",
        256: "#fde68a",
        512: "#fbbf24",
        1024: "#fb923c",
        2048: "#f87171",
        4096: "#fb7185",
        8192: "#f472b6",
      };
      const colorForValue = (v: number) => colorMap[v] || "#ddd6fe";
      const rollValue = () =>
        cfg.valueDist[Math.floor(Math.random() * cfg.valueDist.length)];

      // Physics engine
      const engine = Engine.create({ enableSleeping: true });
      engine.world.gravity.y = cfg.gravity;
      engine.velocityIterations = 6;
      engine.positionIterations = 6;

      // Walls
      const WALL_THICK = cfg.radius;
      let walls = [
        Bodies.rectangle(
          cfg.radius / 2,
          cfg.boardH / 2,
          WALL_THICK,
          cfg.boardH,
          {
            isStatic: true,
            label: "wall",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW - cfg.radius / 2,
          cfg.boardH / 2,
          WALL_THICK,
          cfg.boardH,
          {
            isStatic: true,
            label: "wall",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW / 2,
          cfg.boardH - cfg.radius / 2,
          cfg.boardW,
          WALL_THICK,
          {
            isStatic: true,
            label: "floor",
            render: { visible: false },
          }
        ),
        Bodies.rectangle(
          cfg.boardW / 2,
          -cfg.radius,
          cfg.boardW,
          cfg.radius * 2,
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
        const body = Bodies.circle(x, y, cfg.radius, {
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
          colorForValue(newValue)
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
        newColor: string
      ) {
        const particleCount = 8 + Math.floor(Math.random() * 4);

        for (let i = 0; i < particleCount; i++) {
          const angle =
            (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
          const speed = 80 + Math.random() * 40;
          const size = 3 + Math.random() * 4;
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
        let r = cfg.radius;
        let actualX = x,
          actualY = y;

        const anim = state.animations.get(bodyId);
        if (anim && anim.type === "spawn") {
          r = cfg.radius * anim.scale;
          if (r < 1) return;
        }

        const fill = colorForValue(value);
        ctx.save();

        const glowMultiplier =
          anim && anim.type === "spawn" ? 1 + anim.scale : 1;
        ctx.shadowColor = fill;
        ctx.shadowBlur = 16 * glowMultiplier;

        ctx.beginPath();
        ctx.arc(actualX, actualY, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.lineWidth = 4 * (r / cfg.radius);
        ctx.strokeStyle = "rgba(255,255,255,.22)";
        ctx.beginPath();
        ctx.arc(actualX, actualY, Math.max(1, r - 3), 0, Math.PI * 2);
        ctx.stroke();

        const grad = ctx.createRadialGradient(
          actualX - r * 0.4,
          actualY - r * 0.6,
          1,
          actualX,
          actualY,
          r
        );
        grad.addColorStop(0, "rgba(255,255,255,.35)");
        grad.addColorStop(0.25, "rgba(255,255,255,.15)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(actualX, actualY, Math.max(1, r - 2), 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        if (r > cfg.radius * 0.3) {
          ctx.fillStyle = "#0b0e15";
          const fontSize = Math.max(12, 18 * (r / cfg.radius));
          ctx.font = `bold ${fontSize}px Inter, ui-sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
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
          const x = state.previewX,
            y = cfg.spawnY;
          const v = state.nextValue,
            r = cfg.radius;
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
          ctx.font = `bold ${18 * pulse}px Inter, ui-sans-serif`;
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
        state.previewX = Math.max(
          cfg.radius,
          Math.min(cfg.boardW - cfg.radius, x)
        );
      }

      function isSpawnFree(x: number, y: number) {
        for (const data of state.circles.values()) {
          const dx = x - data.body.position.x;
          const dy = y - data.body.position.y;
          if (Math.hypot(dx, dy) < cfg.radius * 2.2) return false;
        }

        if (y < cfg.radius || y > cfg.boardH - cfg.radius) return false;
        if (x < cfg.radius || x > cfg.boardW - cfg.radius) return false;

        return true;
      }

      function tryDrop() {
        if (!state.running || state.ended || state.paused) return;
        const now = performance.now();
        if (now - state.lastDropTs < cfg.dropCooldownMs) return;

        let x = state.previewX;
        let y = cfg.spawnY;

        if (!isSpawnFree(x, y)) {
          const step = cfg.radius * 1.1;
          let placed = false;

          for (let i = 1; i <= 6; i++) {
            const xl = x - i * step,
              xr = x + i * step;
            if (xl >= cfg.radius && isSpawnFree(xl, y)) {
              x = xl;
              placed = true;
              break;
            }
            if (xr <= cfg.boardW - cfg.radius && isSpawnFree(xr, y)) {
              x = xr;
              placed = true;
              break;
            }
          }

          if (!placed) {
            const higherY = Math.max(cfg.radius, y - cfg.radius);
            for (let i = 0; i <= 6; i++) {
              const testX =
                state.previewX +
                (i % 2 === 0 ? 1 : -1) * Math.floor(i / 2) * step;
              if (
                testX >= cfg.radius &&
                testX <= cfg.boardW - cfg.radius &&
                isSpawnFree(testX, higherY)
              ) {
                x = testX;
                y = higherY;
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

        const C = createCircle(x, y, state.nextValue);
        if (C) {
          state.nextValue = rollValue();
          setGameState((prev) => ({ ...prev, nextValue: state.nextValue }));
          state.lastDropTs = now;
        }
      }

      // Game control
      function checkDangerLine() {
        const now = performance.now();
        for (const data of state.circles.values()) {
          const top = data.body.position.y - cfg.radius;
          const age = now - data.bornAt;

          if (age > cfg.gracePeriodMs && top < cfg.dangerLineY) {
            endGame("Danger line crossed.");
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
        cfg.boardW = newDimensions.dynamicBoardW;

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
        walls = [
          Bodies.rectangle(cfg.boardW / 2, -25, cfg.boardW, 50, {
            isStatic: true,
          }),
          Bodies.rectangle(-25, cfg.boardH / 2, 50, cfg.boardH, {
            isStatic: true,
          }),
          Bodies.rectangle(cfg.boardW + 25, cfg.boardH / 2, 50, cfg.boardH, {
            isStatic: true,
          }),
          Bodies.rectangle(cfg.boardW / 2, cfg.boardH + 25, cfg.boardW, 50, {
            isStatic: true,
          }),
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
          <div className="stage__hud">
            <div className="hud__group">
              <div className="hud__chip">
                <span>Score</span>
                <strong>{gameState.score}</strong>
              </div>
              <div className="hud__chip">
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
            <canvas
              ref={canvasRef}
              width="640"
              height="760"
              aria-label="SUOKA board"
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
