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

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function length2(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

function hash11(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
function hash21(x: number, y: number) {
  const n = x * 127.1 + y * 311.7;
  return hash11(n);
}

// cheap “hue-ish” shift: nudge RGB channels (fast + artistic)
function shiftRGB(r: number, g: number, b: number, hue: number) {
  const t = (hue - 0.5) * 2.0; // -1..1
  const rr = r + t * 38;
  const gg = g + Math.sin(hue * 6.283) * 22;
  const bb = b - t * 32;
  return {
    r: Math.max(0, Math.min(255, rr)),
    g: Math.max(0, Math.min(255, gg)),
    b: Math.max(0, Math.min(255, bb)),
  };
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
type MaterialName = "GLASS" | "CERAMIC" | "METAL";

function palette(mood: number, mode: ModeName) {
  if (mode === "MONO") return { r: 235, g: 240, b: 255 };
  if (mood < 0.33) return { r: 190, g: 225, b: 255 };
  if (mood < 0.66) return { r: 175, g: 255, b: 235 };
  return { r: 215, g: 190, b: 255 };
}

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
  _lerp: Lerp,
) {
  const g = canvas.getContext("2d")!;
  const { Engine, Bodies, Composite, Body } = Matter;

  const engine = Engine.create();
  engine.gravity.scale = 0;
  const world = engine.world;

  let w = 0;
  let h = 0;

  let mx = 0.5;
  let my = 0.5;

  let mood = 0;
  let mode: ModeName = "ICE";
  let material: MaterialName = "GLASS";

  const V = {
    // render
    sparkleChance: 0.060,

    // cages grid
    cagePadding: 10,
    cageSafe: 0.18,           // safe margin ratio inside cage
    cageJitter: 0.08,         // slight per-cell offset (still grid-like)
    cageSizeMin: 58,
    cageSizeMax: 150,

    // steering (inside cage)
    steerK: 0.000020,
    steerNoiseK: 0.000006,
    steerDamping: 0.000010,
    targetHoldMin: 0.9,
    targetHoldMax: 2.2,

    // curl field
    curlK: 1.65,

    // impulses
    impulseChance: 0.018,
    impulseStrength: 0.00045,

    // magnets (repulsion only, subtle)
    magnetCount: 3,
    magnetForce: 0.000035,
    magnetRadius: 520,
    magnetWobble: 0.16,

    // mouse repulsion
    mouseRepelBoost: 1.15,

    // spawn
    spawnPadding: 28,

    // material detail intensity
    glassRefractA: 0.055,
    glassChromA: 0.050,
    metalBrushA: 0.085,
    ceramicGrainA: 0.055,
  } as const;

  function materialKnobs(mat: MaterialName) {
    switch (mat) {
      case "CERAMIC":
        return { fill: 0.062, stroke: 0.13, fresnel: 0.060, spec: 0.10, glow: 0.060, shadow: 0.10, rough: 0.58 };
      case "METAL":
        return { fill: 0.042, stroke: 0.16, fresnel: 0.040, spec: 0.19, glow: 0.050, shadow: 0.12, rough: 0.20 };
      default:
        return { fill: 0.072, stroke: 0.12, fresnel: 0.090, spec: 0.145, glow: 0.085, shadow: 0.085, rough: 0.33 };
    }
  }

  function computeCageSize(count: number) {
    const areaPer = (w * h) / Math.max(1, count);
    const s = Math.sqrt(areaPer) * 0.92;
    return clamp(s, V.cageSizeMin, V.cageSizeMax);
  }

  type Cage = {
    cx: number;
    cy: number;
    size: number;
    seed: number;
  };

  type Meta = {
    body: Matter.Body;
    cage: Cage;
    hue: number;
    scale: number;
    targetX: number;
    targetY: number;
    targetUntil: number;
    nextMorph: number;
    nextColor: number;
    id: number;
  };

  let metas: Meta[] = [];

  function makeCapsule(x: number, y: number, length: number, radius: number, common: any) {
    const rect = Bodies.rectangle(x, y, Math.max(8, length), Math.max(6, radius * 2), {
      ...common,
      chamfer: { radius: radius * 0.85 },
    });
    const c1 = Bodies.circle(x - length * 0.5, y, radius, common);
    const c2 = Bodies.circle(x + length * 0.5, y, radius, common);
    return Body.create({ parts: [rect, c1, c2], restitution: common.restitution, frictionAir: common.frictionAir, density: common.density });
  }

  function makeBodyAt(x: number, y: number, cageSize: number) {
    const base = clamp(cageSize * (0.16 + Math.random() * 0.10), 7, 18);
    const kind = Math.random();

    const common = {
      restitution: clamp(cfg.restitution, 0.85, 0.98),
      frictionAir: clamp(cfg.frictionAir, 0.007, 0.030),
      density: cfg.density,
    };

    let b: Matter.Body;
    if (kind < 0.30) {
      b = Bodies.circle(x, y, base * (0.85 + Math.random() * 0.25), common);
    } else if (kind < 0.58) {
      b = Bodies.rectangle(x, y, base * (1.7 + Math.random() * 1.5), base * (1.0 + Math.random() * 1.1), {
        ...common,
        chamfer: { radius: base * (0.45 + Math.random() * 0.25) },
      });
    } else if (kind < 0.80) {
      const sides = 3 + Math.floor(Math.random() * 6);
      b = Bodies.polygon(x, y, sides, base * (1.0 + Math.random() * 0.6), {
        ...common,
        chamfer: { radius: base * (0.30 + Math.random() * 0.30) },
      });
    } else {
      const len = base * (2.0 + Math.random() * 2.0);
      const rad = base * (0.55 + Math.random() * 0.25);
      b = makeCapsule(x, y, len, rad, common);
    }

    // isolate bodies: each lives in its cage (no inter collisions)
    b.collisionFilter.group = -1;
    b.collisionFilter.mask = 0;

    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.18);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 1.6 });
    return b;
  }

  function gridCages(count: number, cageSize: number) {
    const pad = V.spawnPadding;
    const W = Math.max(1, w - pad * 2);
    const H = Math.max(1, h - pad * 2);
    const aspect = W / Math.max(H, 1);

    const cols = Math.max(10, Math.round(Math.sqrt(count * aspect)));
    const rows = Math.max(10, Math.round(count / cols));

    const dx = W / cols;
    const dy = H / rows;

    const cages: Cage[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const sx = pad + (i + 0.5) * dx;
        const sy = pad + (j + 0.5) * dy;
        const seed = Math.random() * 10000;

        // tiny per-cell offset (still a grid)
        const jx = (noise2(sx * 0.01, sy * 0.01) - 0.5) * dx * V.cageJitter;
        const jy = (noise2(sx * 0.01 + 13.7, sy * 0.01 + 9.3) - 0.5) * dy * V.cageJitter;

        cages.push({
          cx: clamp(sx + jx, cageSize * 0.5, w - cageSize * 0.5),
          cy: clamp(sy + jy, cageSize * 0.5, h - cageSize * 0.5),
          size: cageSize,
          seed,
        });
      }
    }
    shuffleInPlace(cages);
    return cages.slice(0, count);
  }

  function randomTargetInside(c: Cage) {
    const half = c.size * 0.5 - V.cagePadding;
    const safe = half * (1 - V.cageSafe);
    const tx = c.cx + (Math.random() * 2 - 1) * safe;
    const ty = c.cy + (Math.random() * 2 - 1) * safe;
    return { x: tx, y: ty };
  }

  function rebuildAll() {
    Composite.clear(world, false);

    const count = cfg.count;
    const cageSize = computeCageSize(count);
    const cages = gridCages(count, cageSize);

    metas = [];
    const bodies: Matter.Body[] = [];

    for (let i = 0; i < count; i++) {
      const c = cages[i];
      const t = randomTargetInside(c);

      const b = makeBodyAt(c.cx, c.cy, cageSize);
      bodies.push(b);

      metas.push({
        body: b,
        cage: c,
        hue: Math.random(),
        scale: 1.0,
        targetX: t.x,
        targetY: t.y,
        targetUntil: 0,
        nextMorph: 2.0 + Math.random() * 5.0,
        nextColor: 0.7 + Math.random() * 2.2,
        id: i + 1,
      });
    }

    Composite.add(world, bodies);
  }

  function magnetPositions(t: number) {
    const mags: { x: number; y: number }[] = [];
    const a = Math.min(w, h) * 0.30;
    const cx = w * 0.5;
    const cy = h * 0.5;

    for (let i = 0; i < V.magnetCount; i++) {
      const ph = i * 2.1;
      const x = cx + a * Math.sin(t * (0.20 + V.magnetWobble * 0.10) + ph) + a * 0.45 * Math.sin(t * 0.11 + ph * 1.7);
      const y = cy + a * Math.cos(t * (0.18 + V.magnetWobble * 0.12) + ph) + a * 0.35 * Math.cos(t * 0.13 + ph * 1.3);
      mags.push({ x, y });
    }
    return mags;
  }

  function keepInsideSteer(b: Matter.Body, c: Cage) {
    const half = c.size * 0.5 - V.cagePadding;
    const left = c.cx - half, right = c.cx + half, top = c.cy - half, bottom = c.cy + half;

    const x = b.position.x, y = b.position.y;
    if (x < left || x > right || y < top || y > bottom) {
      Body.setPosition(b, { x: clamp(x, left, right), y: clamp(y, top, bottom) });
      Body.setVelocity(b, { x: b.velocity.x * 0.35, y: b.velocity.y * 0.35 });
    }
  }

  function morph(meta: Meta, t: number) {
    if (t >= meta.nextColor) {
      meta.hue = (meta.hue + 0.18 + Math.random() * 0.35) % 1;
      meta.nextColor = t + (0.7 + Math.random() * 2.2);
    }
    if (t < meta.nextMorph) return;
    meta.nextMorph = t + (2.0 + Math.random() * 6.0);

    const b = meta.body;
    const c = meta.cage;

    if (Math.random() < 0.60) {
      const target = clamp(0.70 + Math.random() * 0.80, 0.60, 1.55);
      const s = target / Math.max(0.001, meta.scale);
      meta.scale = target;
      Body.scale(b, s, s);
      return;
    }

    const pos = { x: b.position.x, y: b.position.y };
    const vel = { x: b.velocity.x, y: b.velocity.y };
    const av = b.angularVelocity;
    const ang = b.angle;

    Composite.remove(world, b);

    const nb = makeBodyAt(pos.x, pos.y, c.size);
    Body.setAngle(nb, ang);
    Body.setVelocity(nb, vel);
    Body.setAngularVelocity(nb, av);

    meta.body = nb;
    Composite.add(world, nb);

    keepInsideSteer(nb, c);
  }

  function applyForces(t: number) {
    const wSafe = Math.max(w, 1);
    const hSafe = Math.max(h, 1);

    const mags = magnetPositions(t);
    const mr2 = V.magnetRadius * V.magnetRadius;

    for (const meta of metas) {
      const b = meta.body;
      const c = meta.cage;

      if (t >= meta.targetUntil) {
        const target = randomTargetInside(c);
        meta.targetX = target.x;
        meta.targetY = target.y;
        meta.targetUntil = t + (V.targetHoldMin + Math.random() * (V.targetHoldMax - V.targetHoldMin));
      }

      const dx = meta.targetX - b.position.x;
      const dy = meta.targetY - b.position.y;
      const d = Math.max(1, length2(dx, dy));
      const nx = dx / d;
      const ny = dy / d;

      const steer = V.steerK * clamp(d / (c.size * 0.35), 0.25, 1.25);
      Body.applyForce(b, b.position, { x: nx * steer, y: ny * steer });

      const px = b.position.x * 0.004;
      const py = b.position.y * 0.004;
      const cu = curlNoise(noise2, px, py, t);
      Body.applyForce(b, b.position, { x: cu.x * cfg.turbulence * V.curlK, y: cu.y * cfg.turbulence * V.curlK });

      const jx = (noise2(px + t * 0.7, py) - 0.5) * V.steerNoiseK;
      const jy = (noise2(px, py + t * 0.7) - 0.5) * V.steerNoiseK;
      Body.applyForce(b, b.position, { x: jx, y: jy });

      for (const m of mags) {
        const mdx = b.position.x - m.x;
        const mdy = b.position.y - m.y;
        const dd2 = mdx * mdx + mdy * mdy;
        if (dd2 < mr2) {
          const dd = Math.sqrt(dd2) + 0.001;
          const falloff = 1 - dd / V.magnetRadius;
          const strength = V.magnetForce * falloff * falloff;
          Body.applyForce(b, b.position, { x: (mdx / dd) * strength, y: (mdy / dd) * strength });
        }
      }

      const mrx = b.position.x / wSafe - mx;
      const mry = b.position.y / hSafe - my;
      const md = Math.sqrt(mrx * mrx + mry * mry) * Math.max(wSafe, hSafe);
      if (md < cfg.mouseRadius) {
        const s = (1 - md / cfg.mouseRadius) * cfg.mouseForce * V.mouseRepelBoost;
        Body.applyForce(b, b.position, { x: mrx * s, y: mry * s });
      }

      if (Math.random() < V.impulseChance) {
        Body.applyForce(b, b.position, {
          x: (Math.random() - 0.5) * V.impulseStrength,
          y: (Math.random() - 0.5) * V.impulseStrength,
        });
        Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.25);
      }

      Body.applyForce(b, b.position, { x: -b.velocity.x * V.steerDamping, y: -b.velocity.y * V.steerDamping });
      b.frictionAir = clamp(cfg.frictionAir, 0.007, 0.032);

      morph(meta, t);
      keepInsideSteer(meta.body, c);
    }
  }

  let acc = 0;
  const fixed = 1 / 60;

  // MATERIAL DETAIL PASSES (fast)
  function glassDetail(
    pal: { r: number; g: number; b: number },
    r: number,
    vx: number,
    vy: number,
    t: number,
  ) {
    // fake refraction: inner gradient offset by motion + time
    const sp = Math.min(3.0, Math.max(0.3, Math.sqrt(vx * vx + vy * vy)));
    const ox = (vx / (sp + 0.001)) * r * 0.20 + Math.sin(t * 1.3) * r * 0.06;
    const oy = (vy / (sp + 0.001)) * r * 0.20 + Math.cos(t * 1.2) * r * 0.06;

    const ig = g.createRadialGradient(-ox * 0.6, -oy * 0.6, r * 0.15, ox, oy, r * 1.35);
    ig.addColorStop(0, `rgba(255,255,255,${V.glassRefractA * 0.95})`);
    ig.addColorStop(0.55, `rgba(${pal.r},${pal.g},${pal.b},${V.glassRefractA * 0.55})`);
    ig.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = ig;
    g.fill();

    // caustic glint
    g.globalAlpha = 0.10;
    g.beginPath();
    g.arc(-r * 0.10, -r * 0.18, Math.max(1.5, r * 0.12), 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.fill();
    g.globalAlpha = 1;
  }

  function metalBrush(r: number, seed: number) {
    // brushed anisotropy: few thin lines clipped inside shape
    const spacing = clamp(r * 0.22, 3, 7);
    const lines = Math.min(16, Math.max(6, Math.floor((r * 2) / spacing)));

    g.globalAlpha = V.metalBrushA;

    for (let i = -lines; i <= lines; i++) {
      const x = i * spacing + (hash11(seed + i * 1.7) - 0.5) * 0.9;
      const a = 0.04 + hash11(seed + i * 9.1) * 0.05;
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.moveTo(x, -r * 1.25);
      g.lineTo(x, r * 1.25);
      g.stroke();
    }

    g.globalAlpha = 1;
  }

  function ceramicGrain(r: number, seed: number, t: number) {
    // stable speckles: deterministic positions per object (no shimmer)
    const base = V.ceramicGrainA;

    // subtle dark + light specks
    const k = 7;
    for (let i = 0; i < k; i++) {
      const rx = (hash11(seed + i * 3.1) * 2 - 1) * r * 0.95;
      const ry = (hash11(seed + i * 7.7) * 2 - 1) * r * 0.95;
      const sz = 0.7 + hash11(seed + i * 11.3) * 1.6;
      const flick = 0.85 + 0.15 * Math.sin(t * 0.7 + i * 1.9);

      g.fillStyle = `rgba(255,255,255,${base * 0.16 * flick})`;
      g.beginPath();
      g.arc(rx, ry, sz, 0, TAU);
      g.fill();

      g.fillStyle = `rgba(0,0,0,${base * 0.10 * flick})`;
      g.beginPath();
      g.arc(rx * 0.78, ry * 0.78, sz * 0.75, 0, TAU);
      g.fill();
    }

    // micro grain wash (single pass)
    const gg = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.35);
    gg.addColorStop(0, `rgba(255,255,255,${base * 0.14})`);
    gg.addColorStop(0.6, `rgba(0,0,0,${base * 0.06})`);
    gg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gg;
    g.fill();
  }

  function draw(t: number) {
    if (!cfg.trails) g.clearRect(0, 0, w, h);
    else {
      g.fillStyle = `rgba(0,0,0,${cfg.trailFade})`;
      g.fillRect(0, 0, w, h);
    }

    const pal0 = palette(mood, mode);
    const mk = materialKnobs(material);

    const lx = Math.cos(t * 0.22) * 0.8 + 0.2;
    const ly = Math.sin(t * 0.18) * 0.8 - 0.2;

    // shadows + AO
    for (const meta of metas) {
      const b = meta.body;
      const x = b.position.x;
      const y = b.position.y;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);

      const sx = x + lx * r * 0.55;
      const sy = y + ly * r * 0.55;

      const sh = g.createRadialGradient(sx, sy, r * 0.3, sx, sy, r * 2.2);
      sh.addColorStop(0, `rgba(0,0,0,${mk.shadow})`);
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.arc(sx, sy, r * 2.2, 0, TAU);
      g.fill();

      const ao = g.createRadialGradient(x, y, r * 0.25, x, y, r * (1.35 + mk.rough * 0.85));
      ao.addColorStop(0, `rgba(0,0,0,${mk.shadow * 0.08})`);
      ao.addColorStop(0.55, `rgba(0,0,0,${(mk.shadow + 0.05) * 0.16})`);
      ao.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = ao;
      g.beginPath();
      g.arc(x, y, r * (1.25 + mk.rough * 0.9), 0, TAU);
      g.fill();
    }

    // glow (additive)
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const meta of metas) {
      const b = meta.body;
      const x = b.position.x;
      const y = b.position.y;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);
      const pal = shiftRGB(pal0.r, pal0.g, pal0.b, meta.hue);

      const grad = g.createRadialGradient(x, y, 0, x, y, r * 3.0);
      grad.addColorStop(0, `rgba(${pal.r},${pal.g},${pal.b},${mk.glow * 0.85})`);
      grad.addColorStop(1, `rgba(${pal.r},${pal.g},${pal.b},0.0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 3.0, 0, TAU);
      g.fill();
    }
    g.restore();

    // bodies
    for (const meta of metas) {
      const b = meta.body;
      const x = b.position.x;
      const y = b.position.y;
      const angle = b.angle;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.33, 6, 22);

      const pal = shiftRGB(pal0.r, pal0.g, pal0.b, meta.hue);

      const vx = (b.velocity?.x ?? 0);
      const vy = (b.velocity?.y ?? 0);
      const speed = Math.sqrt(vx * vx + vy * vy);
      const spec = clamp(0.07 + speed * 0.020, 0.07, mk.spec);

      g.save();
      g.translate(x, y);
      g.rotate(angle);

      const verts = b.vertices;
      g.beginPath();
      g.moveTo(verts[0].x - x, verts[0].y - y);
      for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x - x, verts[i].y - y);
      g.closePath();

      // fill (material base)
      const lg = g.createLinearGradient(-r, -r, r, r);
      const baseA = material === "METAL" ? 0.020 : 0.034;
      lg.addColorStop(0, `rgba(255,255,255,${baseA})`);
      lg.addColorStop(1, `rgba(${pal.r},${pal.g},${pal.b},${mk.fill})`);
      g.fillStyle = lg;
      g.fill();

      // --- MATERIAL DETAILS (clipped) ---
      g.save();
      g.clip();

      if (material === "GLASS") {
        glassDetail(pal, r, vx, vy, t);

        // chromatic rim (very subtle)
        g.lineWidth = 1;
        g.globalAlpha = V.glassChromA;
        g.strokeStyle = `rgba(${pal.r},${pal.g},${pal.b},0.05)`;
        g.stroke();
        g.globalAlpha = 1;
      } else if (material === "METAL") {
        // brushed anisotropy aligned to local X axis (after rotate)
        metalBrush(r, meta.id * 17.3 + meta.hue * 91.7);

        // extra spec streak
        g.globalAlpha = 0.22;
        const sg = g.createLinearGradient(-r, -r * 0.35, r, r * 0.35);
        sg.addColorStop(0, "rgba(255,255,255,0)");
        sg.addColorStop(0.5, "rgba(255,255,255,0.10)");
        sg.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = sg;
        g.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
        g.globalAlpha = 1;
      } else {
        // CERAMIC micro grain
        ceramicGrain(r, meta.id * 31.7 + meta.hue * 77.9, t);
      }

      g.restore();
      // --- end material details ---

      // edge + rim
      g.strokeStyle = `rgba(255,255,255,${mk.stroke})`;
      g.lineWidth = 1;
      g.stroke();

      g.strokeStyle = `rgba(255,255,255,${mk.fresnel})`;
      g.lineWidth = 1;
      g.stroke();

      // specular line (phys-ish)
      const specA = spec * (1.0 - mk.rough * 0.55);
      g.strokeStyle = `rgba(255,255,255,${specA})`;
      g.beginPath();
      g.moveTo(-r * 0.68, -r * 0.52);
      g.lineTo(r * 0.20, -r * 0.92);
      g.stroke();

      // glint
      g.fillStyle = `rgba(255,255,255,${specA * 0.60})`;
      g.beginPath();
      g.arc(-r * 0.20, -r * 0.40, 1.2, 0, TAU);
      g.fill();

      // micro sparkle
      const sparkle = material === "GLASS" ? 1.0 : 0.55;
      if (Math.random() < V.sparkleChance * sparkle) {
        g.fillStyle = "rgba(255,255,255,0.10)";
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
      rebuildAll();
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
    setMaterial: (name: string) => {
      const n = name.toUpperCase();
      if (n === "GLASS" || n === "CERAMIC" || n === "METAL") material = n;
    },
    setDensity: (count: number) => {
      const c = clamp(Math.round(count), 60, 240);
      if (c === cfg.count) return;
      cfg.count = c;
      rebuildAll();
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
