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

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

// cheap “hue-ish” shift: nudge RGB channels (keeps it artistic & fast)
function shiftRGB(r: number, g: number, b: number, hue: number) {
  const t = (hue - 0.5) * 2.0; // -1..1
  const rr = r + t * 38;
  const gg = g + Math.sin(hue * 6.283) * 22;
  const bb = b - t * 32;
  return { r: Math.max(0, Math.min(255, rr)), g: Math.max(0, Math.min(255, gg)), b: Math.max(0, Math.min(255, bb)) };
}

export function createPhysicsLayer(
  canvas: HTMLCanvasElement,
  cfg: PhysicsConfig,
  noise2: Noise2,
  clamp: Clamp,
  lerp: Lerp,
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
    // rendering (base; material overrides)
    glowA: 0.085,
    glassFill: 0.070,
    glassStroke: 0.12,
    fresnel: 0.085,
    specular: 0.14,
    shadowA: 0.07,
    sparkleChance: 0.060,

    // AO/contact feel
    aoA: 0.10,
    aoR: 1.55,
    contactA: 0.12,
    contactR: 1.05,

    // cages
    cagePadding: 10,
    cageWobble: 0.20,       // cage center motion amount (relative to cage size)
    wallK: 0.000030,        // soft wall strength
    wallDamp: 0.000010,     // damping near walls

    // internal motion
    curlK: 1.85,            // curl multiplier
    jitterK: 0.000007,      // micro jitter
    impulseChance: 0.020,   // a bit higher for “alive”
    impulseStrength: 0.00055,

    // magnets (repulsion only) - subtle now, to avoid leaving cages
    magnetCount: 3,
    magnetForce: 0.000040,
    magnetRadius: 520,
    magnetWobble: 0.16,

    // mouse repulsion (kept)
    mouseRepelBoost: 1.15,

    // spawn
    spawnPadding: 28,
  } as const;

  function materialKnobs(mat: MaterialName) {
    switch (mat) {
      case "CERAMIC":
        return { fill: 0.060, stroke: 0.13, fresnel: 0.055, spec: 0.10, glow: 0.060, shadow: 0.09, rough: 0.55 };
      case "METAL":
        return { fill: 0.040, stroke: 0.16, fresnel: 0.035, spec: 0.18, glow: 0.050, shadow: 0.11, rough: 0.22 };
      default:
        return { fill: 0.070, stroke: 0.12, fresnel: 0.085, spec: 0.14, glow: 0.085, shadow: 0.07, rough: 0.35 };
    }
  }

  // Even distribution of cage centers (jittered grid)
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
    return Body.create({ parts: [rect, c1, c2], restitution: common.restitution, frictionAir: common.frictionAir, density: common.density });
  }

  type Cage = {
    baseX: number;
    baseY: number;
    size: number;  // square size
    seed: number;
  };

  type Meta = {
    body: Matter.Body;
    cage: Cage;
    hue: number;
    scale: number;
    nextMorph: number;
    nextColor: number;
  };

  let metas: Meta[] = [];

  function computeCageSize(count: number) {
    const areaPer = (w * h) / Math.max(1, count);
    // small squares, but not too tiny
    const s = Math.sqrt(areaPer) * 0.92;
    return clamp(s, 56, 150);
  }

  function makeBodyAt(i: number, x: number, y: number, size: number) {
    const base = clamp(size * (0.16 + Math.random() * 0.10), 7, 18); // size tied to cage
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

    // isolate bodies: no inter-collisions (each has its own cage)
    b.collisionFilter.group = -1; // all share same negative group => no collisions
    b.collisionFilter.mask = 0;

    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.18);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 1.8, y: (Math.random() - 0.5) * 1.8 });

    return b;
  }

  function rebuildAll() {
    // clear world bodies
    Composite.clear(world, false);

    const count = cfg.count;
    const pts = spawnPoints(count);
    const cageSize = computeCageSize(count);

    metas = [];
    const bodies: Matter.Body[] = [];

    for (let i = 0; i < count; i++) {
      const p = pts[i % pts.length];
      const cage: Cage = { baseX: p.x, baseY: p.y, size: cageSize, seed: Math.random() * 10000 };

      const b = makeBodyAt(i, p.x, p.y, cageSize);
      bodies.push(b);

      metas.push({
        body: b,
        cage,
        hue: Math.random(),
        scale: 1.0,
        nextMorph: 2.0 + Math.random() * 5.0,
        nextColor: 0.7 + Math.random() * 2.2,
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

  function cageCenter(c: Cage, t: number) {
    // cage itself moves subtly (alive)
    const wob = c.size * V.cageWobble;
    const nx = noise2(c.baseX * 0.006 + t * 0.05, c.baseY * 0.006);
    const ny = noise2(c.baseX * 0.006, c.baseY * 0.006 + t * 0.05);
    const ox = (Math.sin(t * 0.55 + c.seed) * 0.55 + (nx - 0.5) * 0.9) * wob;
    const oy = (Math.cos(t * 0.50 + c.seed * 1.2) * 0.55 + (ny - 0.5) * 0.9) * wob;

    return {
      x: clamp(c.baseX + ox, c.size * 0.5, w - c.size * 0.5),
      y: clamp(c.baseY + oy, c.size * 0.5, h - c.size * 0.5),
    };
  }

  function softWalls(b: Matter.Body, cx: number, cy: number, size: number) {
    const half = size * 0.5 - V.cagePadding;

    const left = cx - half;
    const right = cx + half;
    const top = cy - half;
    const bottom = cy + half;

    // spring-like push back in
    const x = b.position.x;
    const y = b.position.y;

    let fx = 0;
    let fy = 0;

    if (x < left) fx += (left - x) * V.wallK;
    if (x > right) fx -= (x - right) * V.wallK;
    if (y < top) fy += (top - y) * V.wallK;
    if (y > bottom) fy -= (y - bottom) * V.wallK;

    // extra damping near walls
    const dx = Math.max(0, Math.max(left - x, x - right));
    const dy = Math.max(0, Math.max(top - y, y - bottom));
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      fx -= b.velocity.x * V.wallDamp;
      fy -= b.velocity.y * V.wallDamp;
    }

    if (fx !== 0 || fy !== 0) {
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }

    // hard clamp if extremely out (safety)
    if (x < left - half || x > right + half || y < top - half || y > bottom + half) {
      Body.setPosition(b, { x: clamp(x, left, right), y: clamp(y, top, bottom) });
      Body.setVelocity(b, { x: b.velocity.x * 0.3, y: b.velocity.y * 0.3 });
    }
  }

  function morph(meta: Meta, t: number) {
    // Change color often, shape/size sometimes
    if (t >= meta.nextColor) {
      meta.hue = (meta.hue + 0.18 + Math.random() * 0.35) % 1;
      meta.nextColor = t + (0.7 + Math.random() * 2.2);
    }

    if (t < meta.nextMorph) return;

    meta.nextMorph = t + (2.0 + Math.random() * 6.0);

    const b = meta.body;
    const c = meta.cage;

    const center = cageCenter(c, t);
    const size = c.size;

    // 60%: scale, 40%: rebuild shape
    if (Math.random() < 0.60) {
      const target = clamp(0.70 + Math.random() * 0.80, 0.60, 1.55);
      const s = target / Math.max(0.001, meta.scale);
      meta.scale = target;
      Body.scale(b, s, s);
      return;
    }

    // rebuild shape (preserve motion)
    const pos = { x: b.position.x, y: b.position.y };
    const vel = { x: b.velocity.x, y: b.velocity.y };
    const av = b.angularVelocity;
    const ang = b.angle;

    Composite.remove(world, b);

    const newBody = makeBodyAt((Math.random() * 1e6) | 0, pos.x, pos.y, size);
    Body.setAngle(newBody, ang);
    Body.setVelocity(newBody, vel);
    Body.setAngularVelocity(newBody, av);

    meta.body = newBody;
    Composite.add(world, newBody);

    // keep inside immediately
    softWalls(newBody, center.x, center.y, size);
  }

  function applyForces(t: number) {
    const wSafe = Math.max(w, 1);
    const hSafe = Math.max(h, 1);

    const mags = magnetPositions(t);
    const mr2 = V.magnetRadius * V.magnetRadius;

    for (const meta of metas) {
      const b = meta.body;
      const c = meta.cage;

      const cc = cageCenter(c, t);
      const size = c.size;

      // soft walls: keep inside cage
      softWalls(b, cc.x, cc.y, size);

      // internal unpredictable motion (curl + micro jitter)
      const px = b.position.x * 0.004;
      const py = b.position.y * 0.004;
      const cu = curlNoise(noise2, px, py, t);

      Body.applyForce(b, b.position, {
        x: cu.x * cfg.turbulence * V.curlK,
        y: cu.y * cfg.turbulence * V.curlK,
      });

      const jx = (noise2(px + t * 0.7, py) - 0.5) * V.jitterK * (0.8 + Math.random() * 0.6);
      const jy = (noise2(px, py + t * 0.7) - 0.5) * V.jitterK * (0.8 + Math.random() * 0.6);
      Body.applyForce(b, b.position, { x: jx, y: jy });

      // subtle global repulsive magnets (doesn't break cages)
      for (const m of mags) {
        const dx = b.position.x - m.x;
        const dy = b.position.y - m.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < mr2) {
          const d = Math.sqrt(d2) + 0.001;
          const falloff = 1 - d / V.magnetRadius;
          const strength = V.magnetForce * falloff * falloff;
          Body.applyForce(b, b.position, { x: (dx / d) * strength, y: (dy / d) * strength });
        }
      }

      // mouse repulsion
      const mdx = b.position.x / wSafe - mx;
      const mdy = b.position.y / hSafe - my;
      const md = Math.sqrt(mdx * mdx + mdy * mdy) * Math.max(wSafe, hSafe);
      if (md < cfg.mouseRadius) {
        const s = (1 - md / cfg.mouseRadius) * cfg.mouseForce * V.mouseRepelBoost;
        Body.applyForce(b, b.position, { x: mdx * s, y: mdy * s });
      }

      // impulses (alive)
      if (Math.random() < V.impulseChance) {
        Body.applyForce(b, b.position, {
          x: (Math.random() - 0.5) * V.impulseStrength,
          y: (Math.random() - 0.5) * V.impulseStrength,
        });
        Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.25);
      }

      // morph (color/size/shape)
      morph(meta, t);

      // damping
      b.frictionAir = clamp(cfg.frictionAir, 0.007, 0.032);
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

    const pal0 = palette(mood, mode);
    const mk = materialKnobs(material);

    const lx = Math.cos(t * 0.22) * 0.8 + 0.2;
    const ly = Math.sin(t * 0.18) * 0.8 - 0.2;

    // contact + AO based on each object (real depth)
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

      // AO
      const ao = g.createRadialGradient(x, y, r * 0.25, x, y, r * (1.35 + mk.rough * 0.85));
      ao.addColorStop(0, `rgba(0,0,0,${mk.shadow * 0.08})`);
      ao.addColorStop(0.55, `rgba(0,0,0,${(mk.shadow + 0.05) * 0.16})`);
      ao.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = ao;
      g.beginPath();
      g.arc(x, y, r * (1.25 + mk.rough * 0.9), 0, TAU);
      g.fill();

      // tight contact
      const cx = x + lx * r * 0.18;
      const cy = y + ly * r * 0.18;
      const cs = g.createRadialGradient(cx, cy, r * 0.10, cx, cy, r * (0.85 + mk.rough * 0.7));
      cs.addColorStop(0, `rgba(0,0,0,${Math.min(0.18, mk.shadow * 0.55)})`);
      cs.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = cs;
      g.beginPath();
      g.arc(cx, cy, r * (0.85 + mk.rough * 0.7), 0, TAU);
      g.fill();
    }

    // glow pass (additive)
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

    // main bodies
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

      // fill (material)
      const lg = g.createLinearGradient(-r, -r, r, r);
      const baseA = material === "METAL" ? (0.020) : (0.034);
      lg.addColorStop(0, `rgba(255,255,255,${baseA})`);
      lg.addColorStop(1, `rgba(${pal.r},${pal.g},${pal.b},${mk.fill})`);
      g.fillStyle = lg;
      g.fill();

      // edge + rim
      g.strokeStyle = `rgba(255,255,255,${mk.stroke})`;
      g.lineWidth = 1;
      g.stroke();

      g.strokeStyle = `rgba(255,255,255,${mk.fresnel})`;
      g.lineWidth = 1;
      g.stroke();

      // specular line
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
