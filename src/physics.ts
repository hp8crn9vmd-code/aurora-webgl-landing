import Matter from "matter-js";

export type PhysicsConfig = {
  enabled?: boolean;
  startDelayMs?: number;
  count: number;
  restitution: number;
  frictionAir: number;
  density: number;
  constraintRatio: number;
  trails: boolean;
  trailFade: number;
  turbulence: number;
  impulseChance: number;
  impulseStrength: number;
  mouseForce: number;
  mouseRadius: number;
};

type Noise2 = (x: number, y: number) => number;
type Clamp = (v: number, a: number, b: number) => number;
type Lerp = (a: number, b: number, t: number) => number;

const TAU = Math.PI * 2;

function rand01(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function curlNoise(noise2: Noise2, x: number, y: number, t: number) {
  const e = 0.75;
  const n1 = noise2(x + e + t * 0.22, y);
  const n2 = noise2(x - e + t * 0.22, y);
  const n3 = noise2(x, y + e + t * 0.22);
  const n4 = noise2(x, y - e + t * 0.22);

  const dx = (n1 - n2) / (2 * e);
  const dy = (n3 - n4) / (2 * e);

  return { x: dy, y: -dx };
}

type ModeName = "ICE" | "NEON" | "VIOLET" | "MONO";
function palette(mood: number, mode: ModeName) {
  if (mode === "MONO") return { r: 235, g: 240, b: 255 };
  if (mood < 0.33) return { r: 190, g: 225, b: 255 };
  if (mood < 0.66) return { r: 175, g: 255, b: 235 };
  return { r: 215, g: 190, b: 255 };
}

type CellKey = string;
const cellKey = (ix: number, iy: number): CellKey => `${ix},${iy}`;

function shuffleInPlace<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export function createPhysicsLayer(
  canvas: HTMLCanvasElement,
  cfg: PhysicsConfig,
  noise2: Noise2,
  clamp: Clamp,
  lerp: Lerp,
) {
  const g = canvas.getContext("2d")!;
  const { Engine, Bodies, Composite, Body, Constraint } = Matter;

  const engine = Engine.create();
  engine.gravity.scale = 0;
  const world = engine.world;

  let bounds: Matter.Body[] = [];
  let bodies: Matter.Body[] = [];
  let constraints: Matter.Constraint[] = [];

  let w = 0;
  let h = 0;

  let mx = 0.5;
  let my = 0.5;

  let mood = 0;
  let mode: ModeName = "ICE";

  const V = {
    // “real” rendering knobs
    glowA: 0.085,
    glassFill: 0.070,
    glassStroke: 0.12,
    fresnel: 0.085,       // rim light
    specular: 0.14,       // highlight strength
    shadowA: 0.07,        // under-shadow strength
    sparkleChance: 0.060,

    // composition
    centerForce: 0.0000035,
    edgeRepel: 0.000012,

    // anti-cluster
    cellSize: 110,
    repelRadius: 95,
    repelForce: 0.000030,

    // magnets (REPULSION ONLY)
    magnetCount: 4,
    magnetForce: 0.000080,
    magnetRadius: 620,
    magnetWobble: 0.18,

    // mouse behaves as repulsive magnet too (premium)
    mouseRepelBoost: 1.25,

    // springs
    springStiffness: 0.0022,
    springDamping: 0.14,
    springLenMin: 40,
    springLenMax: 120,
    springPerBody: 1,
    maxSprings: 220,

    // spawn
    spawnPadding: 32,
  } as const;

  function rebuildBounds() {
    bounds.forEach((b) => Composite.remove(world, b));
    const thick = 160;
    bounds = [
      Bodies.rectangle(w / 2, -thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w / 2, h + thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(-thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w + thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
    ];
    Composite.add(world, bounds);
  }

  function spawnPoints(count: number) {
    const pts: { x: number; y: number }[] = [];
    const pad = V.spawnPadding;

    const W = Math.max(1, w - pad * 2);
    const H = Math.max(1, h - pad * 2);
    const aspect = W / Math.max(H, 1);

    const cols = Math.max(10, Math.round(Math.sqrt(count * aspect)));
    const rows = Math.max(10, Math.round(count / cols));

    const dx = W / cols;
    const dy = H / rows;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = pad + (i + 0.5) * dx + (Math.random() - 0.5) * dx * 0.70;
        const y = pad + (j + 0.5) * dy + (Math.random() - 0.5) * dy * 0.70;
        pts.push({ x: clamp(x, pad, w - pad), y: clamp(y, pad, h - pad) });
      }
    }
    shuffleInPlace(pts);
    return pts.slice(0, count);
  }

  function makeCapsule(x: number, y: number, length: number, radius: number, common: any) {
    const rect = Bodies.rectangle(x, y, Math.max(8, length), Math.max(6, radius * 2), {
      ...common,
      chamfer: { radius: radius * 0.85 },
    });
    const c1 = Bodies.circle(x - length * 0.5, y, radius, common);
    const c2 = Bodies.circle(x + length * 0.5, y, radius, common);

    return Body.create({
      parts: [rect, c1, c2],
      restitution: common.restitution,
      frictionAir: common.frictionAir,
      density: common.density,
    });
  }

  function makeBody(i: number, pt: { x: number; y: number }) {
    const x = pt.x;
    const y = pt.y;

    const base = 6 + Math.random() * 10; // small => fill screen
    const kind = Math.random();

    const common = {
      restitution: cfg.restitution,
      frictionAir: cfg.frictionAir,
      density: cfg.density,
    };

    let b: Matter.Body;

    if (kind < 0.34) {
      b = Bodies.circle(x, y, base * (0.85 + Math.random() * 0.25), common);
    } else if (kind < 0.62) {
      b = Bodies.rectangle(
        x,
        y,
        base * (1.8 + Math.random() * 1.6),
        base * (1.0 + Math.random() * 1.2),
        { ...common, chamfer: { radius: base * (0.45 + Math.random() * 0.25) } },
      );
    } else if (kind < 0.84) {
      const sides = 3 + Math.floor(Math.random() * 6);
      b = Bodies.polygon(x, y, sides, base * (1.0 + Math.random() * 0.6), {
        ...common,
        chamfer: { radius: base * (0.30 + Math.random() * 0.30) },
      });
    } else {
      const len = base * (2.2 + Math.random() * 2.2);
      const rad = base * (0.55 + Math.random() * 0.25);
      b = makeCapsule(x, y, len, rad, common);
    }

    (b as any)._style = {
      tint: rand01(i * 33.7) * 0.45 + 0.25,
      massBias: rand01(i * 12.2) * 0.8 + 0.6,
      flow: rand01(i * 66.6) * 1.7 + 0.4,
      impulse: rand01(i * 88.8) * 1.2 + 0.4,
      bias: rand01(i * 111.1),
    };

    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.12);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 2.0, y: (Math.random() - 0.5) * 2.0 });

    return b;
  }

  function clearAll() {
    bodies.forEach((b) => Composite.remove(world, b));
    constraints.forEach((c) => Composite.remove(world, c));
    bodies = [];
    constraints = [];
  }

  function buildSpatialGrid(cs: number) {
    const grid = new Map<CellKey, Matter.Body[]>();
    for (const b of bodies) {
      const ix = Math.floor(b.position.x / cs);
      const iy = Math.floor(b.position.y / cs);
      const k = cellKey(ix, iy);
      const arr = grid.get(k);
      if (arr) arr.push(b);
      else grid.set(k, [b]);
    }
    return grid;
  }

  function addMicroSprings() {
    const cs = V.cellSize;
    const grid = buildSpatialGrid(cs);
    let added = 0;

    for (const b of bodies) {
      if (added >= V.maxSprings) break;

      const ix = Math.floor(b.position.x / cs);
      const iy = Math.floor(b.position.y / cs);

      const candidates: Matter.Body[] = [];
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const arr = grid.get(cellKey(ix + ox, iy + oy));
          if (arr) candidates.push(...arr);
        }
      }
      if (candidates.length < 2) continue;

      for (let k = 0; k < V.springPerBody; k++) {
        if (added >= V.maxSprings) break;

        const other = candidates[(Math.random() * candidates.length) | 0];
        if (other === b) continue;

        const dx = other.position.x - b.position.x;
        const dy = other.position.y - b.position.y;
        const d = Math.sqrt(dx * dx + dy * dy);

        if (d < V.springLenMin || d > V.springLenMax) continue;

        constraints.push(
          Constraint.create({
            bodyA: b,
            bodyB: other,
            stiffness: V.springStiffness * (0.7 + Math.random() * 0.6),
            damping: V.springDamping,
            length: d,
            render: { visible: false },
          }),
        );
        added++;
      }
    }

    if (constraints.length) Composite.add(world, constraints);
  }

  function rebuildBodies() {
    clearAll();

    const pts = spawnPoints(cfg.count);
    for (let i = 0; i < cfg.count; i++) bodies.push(makeBody(i, pts[i % pts.length]));

    Composite.add(world, bodies);
    addMicroSprings();
  }

  function applyCompositionForces(b: Matter.Body) {
    const cx = w * 0.5;
    const cy = h * 0.5;

    const dxC = (cx - b.position.x) / Math.max(w, 1);
    const dyC = (cy - b.position.y) / Math.max(h, 1);
    Body.applyForce(b, b.position, { x: dxC * V.centerForce, y: dyC * V.centerForce });

    const margin = 110;
    const left = margin - b.position.x;
    const right = b.position.x - (w - margin);
    const top = margin - b.position.y;
    const bottom = b.position.y - (h - margin);

    if (left > 0) Body.applyForce(b, b.position, { x: V.edgeRepel * (left / margin), y: 0 });
    if (right > 0) Body.applyForce(b, b.position, { x: -V.edgeRepel * (right / margin), y: 0 });
    if (top > 0) Body.applyForce(b, b.position, { x: 0, y: V.edgeRepel * (top / margin) });
    if (bottom > 0) Body.applyForce(b, b.position, { x: 0, y: -V.edgeRepel * (bottom / margin) });
  }

  function magnetPositions(t: number) {
    const mags: { x: number; y: number }[] = [];
    const a = Math.min(w, h) * 0.33;
    const cx = w * 0.5;
    const cy = h * 0.5;

    for (let i = 0; i < V.magnetCount; i++) {
      const ph = i * 2.1;
      const x =
        cx +
        a * Math.sin(t * (0.20 + V.magnetWobble * 0.10) + ph) +
        a * 0.52 * Math.sin(t * 0.11 + ph * 1.7);
      const y =
        cy +
        a * Math.cos(t * (0.18 + V.magnetWobble * 0.12) + ph) +
        a * 0.42 * Math.cos(t * 0.13 + ph * 1.3);
      mags.push({ x, y });
    }
    return mags;
  }

  function applyAntiClusterSpatialHash() {
    const cs = V.cellSize;
    const grid = buildSpatialGrid(cs);

    const r = V.repelRadius;
    const r2 = r * r;

    for (const b of bodies) {
      const ix = Math.floor(b.position.x / cs);
      const iy = Math.floor(b.position.y / cs);

      let near = 0;

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const arr = grid.get(cellKey(ix + ox, iy + oy));
          if (!arr) continue;

          for (const o of arr) {
            if (o === b) continue;
            const dx = b.position.x - o.position.x;
            const dy = b.position.y - o.position.y;
            const d2 = dx * dx + dy * dy;

            if (d2 > 0.0001 && d2 < r2) {
              near++;
              const d = Math.sqrt(d2);
              const s = (1 - d / r) * V.repelForce;
              Body.applyForce(b, b.position, { x: (dx / d) * s, y: (dy / d) * s });
            }
          }
        }
      }

      if (near >= 10) {
        const cx = w * 0.5;
        const cy = h * 0.5;
        const dx = b.position.x - cx;
        const dy = b.position.y - cy;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        Body.applyForce(b, b.position, { x: (dx / d) * 0.000012, y: (dy / d) * 0.000012 });
      }
    }
  }

  function applyForces(t: number) {
    const wSafe = Math.max(w, 1);
    const hSafe = Math.max(h, 1);

    const ax = (0.5 + 0.16 * Math.sin(t * 0.17)) * wSafe;
    const ay = (0.5 + 0.16 * Math.cos(t * 0.13)) * hSafe;

    const mags = magnetPositions(t);

    applyAntiClusterSpatialHash();

    const mr2 = V.magnetRadius * V.magnetRadius;

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const st = (b as any)._style as {
        flow: number;
        impulse: number;
        massBias: number;
        tint: number;
        bias: number;
      };

      // curl flow field
      const px = b.position.x * 0.004;
      const py = b.position.y * 0.004;
      const c = curlNoise(noise2, px, py, t);

      Body.applyForce(b, b.position, {
        x: c.x * cfg.turbulence * 1.70 * st.flow,
        y: c.y * cfg.turbulence * 1.70 * st.flow,
      });

      // soft coherence drift
      Body.applyForce(b, b.position, {
        x: ((ax - b.position.x) / wSafe) * 0.000003,
        y: ((ay - b.position.y) / hSafe) * 0.000003,
      });

      // ✅ MAGNETS: REPULSION ONLY (push away from magnets)
      for (const m of mags) {
        const dx = b.position.x - m.x; // away direction
        const dy = b.position.y - m.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < mr2) {
          const d = Math.sqrt(d2) + 0.001;
          const falloff = 1 - d / V.magnetRadius;
          const strength = V.magnetForce * falloff * falloff * (0.75 + st.tint * 0.85);
          Body.applyForce(b, b.position, { x: (dx / d) * strength, y: (dy / d) * strength });
        }
      }

      // ✅ Mouse: repulsive magnet (push away)
      const mdx = b.position.x / wSafe - mx;
      const mdy = b.position.y / hSafe - my;
      const md = Math.sqrt(mdx * mdx + mdy * mdy) * Math.max(wSafe, hSafe);
      if (md < cfg.mouseRadius) {
        const s = (1 - md / cfg.mouseRadius) * cfg.mouseForce * V.mouseRepelBoost;
        Body.applyForce(b, b.position, { x: mdx * s, y: mdy * s });
      }

      // rare impulses
      const chance = cfg.impulseChance * st.impulse;
      if (Math.random() < chance) {
        Body.applyForce(b, b.position, {
          x: (Math.random() - 0.5) * cfg.impulseStrength * 1.12,
          y: (Math.random() - 0.5) * cfg.impulseStrength * 1.12,
        });
        Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.30);
      }

      b.frictionAir = clamp(cfg.frictionAir * (0.80 + st.massBias * 0.30), 0.007, 0.032);

      applyCompositionForces(b);
    }
  }

  let acc = 0;
  const fixed = 1 / 60;

  function draw(t: number) {
    if (!cfg.trails) g.clearRect(0, 0, w, h);
    else {
      g.fillStyle = `rgba(0,0,0,${cfg.trailFade})`;
      g.fillRect(0, 0, w, h);
    }

    const pal = palette(mood, mode);

    // moving light direction (makes shapes feel "real")
    const lx = Math.cos(t * 0.22) * 0.8 + 0.2;
    const ly = Math.sin(t * 0.18) * 0.8 - 0.2;

    // under-shadow (cheap, realistic depth)
    for (const b of bodies) {
      const x = b.position.x;
      const y = b.position.y;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);

      const sx = x + lx * r * 0.55;
      const sy = y + ly * r * 0.55;

      const sh = g.createRadialGradient(sx, sy, r * 0.3, sx, sy, r * 2.2);
      sh.addColorStop(0, `rgba(0,0,0,${V.shadowA})`);
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.arc(sx, sy, r * 2.2, 0, TAU);
      g.fill();
    }

    // glow pass (additive)
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const b of bodies) {
      const st = (b as any)._style as { tint: number };
      const x = b.position.x;
      const y = b.position.y;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);

      const grad = g.createRadialGradient(x, y, 0, x, y, r * 3.0);
      grad.addColorStop(0, `rgba(${pal.r},${pal.g},${pal.b},${V.glowA * st.tint})`);
      grad.addColorStop(1, `rgba(${pal.r},${pal.g},${pal.b},0.0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 3.0, 0, TAU);
      g.fill();
    }
    g.restore();

    // main “real” glass bodies
    for (const b of bodies) {
      const st = (b as any)._style as { tint: number; bias: number };
      const x = b.position.x;
      const y = b.position.y;
      const angle = b.angle;

      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);

      // speed -> more specular (looks alive)
      const vx = (b.velocity?.x ?? 0);
      const vy = (b.velocity?.y ?? 0);
      const speed = Math.sqrt(vx * vx + vy * vy);
      const spec = clamp(0.08 + speed * 0.018, 0.08, V.specular);

      g.save();
      g.translate(x, y);
      g.rotate(angle);

      // shape path
      const verts = b.vertices;
      g.beginPath();
      g.moveTo(verts[0].x - x, verts[0].y - y);
      for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x - x, verts[i].y - y);
      g.closePath();

      // body fill gradient (realistic glass)
      const lg = g.createLinearGradient(-r, -r, r, r);
      const baseA = mode === "MONO" ? (0.030 + 0.012 * st.tint) : (0.036 + 0.020 * st.tint);
      lg.addColorStop(0, `rgba(255,255,255,${baseA})`);
      lg.addColorStop(1, `rgba(${pal.r},${pal.g},${pal.b},${V.glassFill * st.tint})`);
      g.fillStyle = lg;
      g.fill();

      // outer edge
      g.strokeStyle = `rgba(255,255,255,${V.glassStroke})`;
      g.lineWidth = 1;
      g.stroke();

      // Fresnel rim (fake but looks real)
      g.strokeStyle = `rgba(255,255,255,${V.fresnel})`;
      g.lineWidth = 1;
      g.stroke();

      // specular line (light direction + per-body bias)
      g.strokeStyle = `rgba(255,255,255,${spec})`;
      g.beginPath();
      g.moveTo(-r * (0.72 - st.bias * 0.12), -r * 0.55);
      g.lineTo(r * (0.18 + st.bias * 0.10), -r * (0.95 - st.bias * 0.08));
      g.stroke();

      // specular glint dot
      g.fillStyle = `rgba(255,255,255,${spec * 0.65})`;
      g.beginPath();
      g.arc(-r * 0.20, -r * 0.40, 1.2, 0, TAU);
      g.fill();

      // micro sparkle
      if (Math.random() < V.sparkleChance) {
        g.fillStyle = "rgba(255,255,255,0.11)";
        g.fillRect(-r * 0.15, -r * 0.05, 1.5, 1.5);
      }

      g.restore();
    }
  }

  return {
    resize: (W: number, H: number, _dpr: number) => {
      w = W;
      h = H;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      rebuildBounds();
      rebuildBodies();
    },
    setMouse: (MX: number, MY: number) => {
      mx = MX / Math.max(w, 1);
      my = MY / Math.max(h, 1);
    },
    setMood: (m: number) => {
      mood = clamp(m, 0, 1);
    },
    setMode: (name: string) => {
      const n = name.toUpperCase();
      if (n === "ICE" || n === "NEON" || n === "VIOLET" || n === "MONO") mode = n;
    },
    setDensity: (count: number) => {
      const c = clamp(Math.round(count), 80, 220);
      if (c === cfg.count) return;
      cfg.count = c;
      rebuildBodies();
    },
    step: (t: number, dt: number) => {
      acc += dt;
      acc = Math.min(acc, 0.24);
      while (acc >= fixed) {
        applyForces(t);
        Engine.update(engine, fixed * 1000);
        acc -= fixed;
      }
      draw(t);
    },
  };
}
