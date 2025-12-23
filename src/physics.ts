import Matter from "matter-js";

export type PhysicsConfig = {
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
  // deterministic-ish random per body for "character" (still overall non-deterministic)
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function curlNoise(noise2: Noise2, x: number, y: number, t: number) {
  // divergence-free flow => organic, unpredictable, not jittery
  const e = 0.75;
  const n1 = noise2(x + e + t * 0.25, y);
  const n2 = noise2(x - e + t * 0.25, y);
  const n3 = noise2(x, y + e + t * 0.25);
  const n4 = noise2(x, y - e + t * 0.25);

  const dx = (n1 - n2) / (2 * e);
  const dy = (n3 - n4) / (2 * e);

  // curl = (dy, -dx)
  return { x: dy, y: -dx };
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

  // visual / composition knobs (art-directed)
  const V = {
    glowA: 0.075,
    glowB: 0.018,
    glassFill: 0.055,
    glassStroke: 0.10,
    highlight: 0.09,
    sparkleChance: 0.05,
  } as const;

  function rebuildBounds() {
    bounds.forEach((b) => Composite.remove(world, b));
    const thick = 140;
    bounds = [
      Bodies.rectangle(w / 2, -thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w / 2, h + thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(-thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w + thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
    ];
    Composite.add(world, bounds);
  }

  function makeBody(i: number) {
    const x = Math.random() * w;
    const y = Math.random() * h;

    const base = 10 + Math.random() * 18;
    const kind = Math.random();

    const common = {
      restitution: cfg.restitution,
      frictionAir: cfg.frictionAir,
      density: cfg.density,
    };

    let b: Matter.Body;

    // more "designed" shapes with chamfer (rounded corners)
    if (kind < 0.40) {
      b = Bodies.circle(x, y, base * 0.95, common);
    } else if (kind < 0.72) {
      b = Bodies.rectangle(x, y, base * (1.8 + Math.random() * 1.2), base * (1.0 + Math.random() * 0.8), {
        ...common,
        chamfer: { radius: base * (0.35 + Math.random() * 0.25) },
      });
    } else {
      const sides = 3 + Math.floor(Math.random() * 5);
      b = Bodies.polygon(x, y, sides, base * 1.1, {
        ...common,
        chamfer: { radius: base * (0.25 + Math.random() * 0.30) },
      });
    }

    // "character" parameters for each body
    (b as any)._seed = Math.random() * 1e9;
    (b as any)._style = {
      hue: rand01(i * 97.1) * 60 + 190,            // cool range
      tint: rand01(i * 33.7) * 0.35 + 0.35,        // subtle variation
      massBias: rand01(i * 12.2) * 0.8 + 0.6,
      flow: rand01(i * 66.6) * 1.4 + 0.6,
      impulse: rand01(i * 88.8) * 1.2 + 0.4,
    };

    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.10);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 2.6, y: (Math.random() - 0.5) * 2.6 });

    return b;
  }

  function rebuildBodies() {
    bodies.forEach((b) => Composite.remove(world, b));
    constraints.forEach((c) => Composite.remove(world, c));
    bodies = [];
    constraints = [];

    // create bodies
    for (let i = 0; i < cfg.count; i++) bodies.push(makeBody(i));

    // build "clusters" of soft constraints (gives advanced emergent motion)
    const clusters = 3;
    const per = Math.max(6, Math.floor(cfg.count / clusters));
    for (let c = 0; c < clusters; c++) {
      const start = c * per;
      const end = Math.min(cfg.count, start + per);
      const group = bodies.slice(start, end);
      if (group.length < 3) continue;

      // star constraints to a chosen hub
      const hub = group[Math.floor(Math.random() * group.length)];
      for (const b of group) {
        if (b === hub) continue;
        constraints.push(
          Constraint.create({
            bodyA: hub,
            bodyB: b,
            stiffness: lerp(0.0022, 0.0070, Math.random()),
            damping: lerp(0.08, 0.18, Math.random()),
            length: lerp(60, 220, Math.random()),
            render: { visible: false },
          }),
        );
      }

      // ring constraints (adds organic wobble)
      for (let i = 0; i < group.length; i++) {
        const a = group[i];
        const b = group[(i + 1) % group.length];
        constraints.push(
          Constraint.create({
            bodyA: a,
            bodyB: b,
            stiffness: lerp(0.0018, 0.0052, Math.random()),
            damping: lerp(0.06, 0.16, Math.random()),
            length: lerp(40, 160, Math.random()),
            render: { visible: false },
          }),
        );
      }
    }

    // add a few cross-links for complexity
    const cross = Math.floor(cfg.count * cfg.constraintRatio);
    for (let i = 0; i < cross; i++) {
      const a = bodies[Math.floor(Math.random() * bodies.length)];
      const b = bodies[Math.floor(Math.random() * bodies.length)];
      if (a === b) continue;
      constraints.push(
        Constraint.create({
          bodyA: a,
          bodyB: b,
          stiffness: lerp(0.0018, 0.0045, Math.random()),
          damping: lerp(0.08, 0.18, Math.random()),
          length: lerp(80, 260, Math.random()),
          render: { visible: false },
        }),
      );
    }

    Composite.add(world, bodies);
    Composite.add(world, constraints);
  }

  function applyForces(t: number) {
    const wSafe = Math.max(w, 1);
    const hSafe = Math.max(h, 1);

    // slow drift anchors (subtle, makes composition feel "alive")
    const ax = (0.5 + 0.15 * Math.sin(t * 0.17)) * wSafe;
    const ay = (0.5 + 0.15 * Math.cos(t * 0.13)) * hSafe;

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const st = (b as any)._style as { flow: number; impulse: number; massBias: number };

      const px = b.position.x * 0.004;
      const py = b.position.y * 0.004;

      // curl flow field (main source of non-predictable but smooth motion)
      const c = curlNoise(noise2, px, py, t);
      const fx = c.x * cfg.turbulence * 1.25 * st.flow;
      const fy = c.y * cfg.turbulence * 1.25 * st.flow;
      Body.applyForce(b, b.position, { x: fx, y: fy });

      // ultra-soft attraction to moving anchors (keeps scene coherent)
      const dxA = (ax - b.position.x) / wSafe;
      const dyA = (ay - b.position.y) / hSafe;
      Body.applyForce(b, b.position, { x: dxA * 0.000003, y: dyA * 0.000003 });

      // mouse interaction (premium)
      const dx = b.position.x / wSafe - mx;
      const dy = b.position.y / hSafe - my;
      const dist = Math.sqrt(dx * dx + dy * dy) * Math.max(wSafe, hSafe);
      if (dist < cfg.mouseRadius) {
        const s = (1 - dist / cfg.mouseRadius) * cfg.mouseForce;
        Body.applyForce(b, b.position, { x: -dx * s, y: -dy * s });
      }

      // rare impulses (unpredictable “events”)
      const chance = cfg.impulseChance * st.impulse;
      if (Math.random() < chance) {
        Body.applyForce(b, b.position, {
          x: (Math.random() - 0.5) * cfg.impulseStrength * 1.05,
          y: (Math.random() - 0.5) * cfg.impulseStrength * 1.05,
        });
        Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.28);
      }

      // slightly different damping per body => richer motion
      b.frictionAir = clamp(cfg.frictionAir * (0.85 + st.massBias * 0.25), 0.007, 0.03);
    }
  }

  // fixed-step stability
  let acc = 0;
  const fixed = 1 / 60;

  function draw(t: number) {
    if (!cfg.trails) {
      g.clearRect(0, 0, w, h);
    } else {
      g.fillStyle = `rgba(0,0,0,${cfg.trailFade})`;
      g.fillRect(0, 0, w, h);
    }

    // additive glow pass
    g.save();
    g.globalCompositeOperation = "lighter";

    for (const b of bodies) {
      const st = (b as any)._style as { hue: number; tint: number };
      const x = b.position.x;
      const y = b.position.y;

      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.34, 10, 30);

      const grad = g.createRadialGradient(x, y, 0, x, y, r * 2.8);
      grad.addColorStop(0, `rgba(180,220,255,${V.glowA * st.tint})`);
      grad.addColorStop(1, `rgba(180,220,255,0.0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 2.8, 0, TAU);
      g.fill();
    }
    g.restore();

    // main glass bodies
    for (const b of bodies) {
      const st = (b as any)._style as { hue: number; tint: number };
      const x = b.position.x;
      const y = b.position.y;
      const angle = b.angle;

      // subtle colored glass (still mostly white/ice)
      const baseA = 0.040 + 0.020 * st.tint;
      const strokeA = V.glassStroke;

      g.save();
      g.translate(x, y);
      g.rotate(angle);

      const verts = b.vertices;
      g.beginPath();
      g.moveTo(verts[0].x - x, verts[0].y - y);
      for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x - x, verts[i].y - y);
      g.closePath();

      // gradient fill inside shape (more premium than flat fill)
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.34, 10, 30);
      const lg = g.createLinearGradient(-r, -r, r, r);
      lg.addColorStop(0, `rgba(255,255,255,${baseA})`);
      lg.addColorStop(1, `rgba(210,235,255,${V.glassFill * st.tint})`);
      g.fillStyle = lg;
      g.fill();

      g.strokeStyle = `rgba(255,255,255,${strokeA})`;
      g.lineWidth = 1;
      g.stroke();

      // specular highlight
      g.strokeStyle = `rgba(255,255,255,${V.highlight})`;
      g.beginPath();
      g.moveTo(-r * 0.65, -r * 0.55);
      g.lineTo(r * 0.15, -r * 0.95);
      g.stroke();

      // micro sparkle (rare)
      if (Math.random() < V.sparkleChance) {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(-r * 0.15, -r * 0.05, 1.5, 1.5);
      }

      g.restore();
    }
  }

  return {
    resize: (W: number, H: number) => {
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
    step: (t: number, dt: number) => {
      acc += dt;
      acc = Math.min(acc, 0.2);
      while (acc >= fixed) {
        applyForces(t);
        Engine.update(engine, fixed * 1000);
        acc -= fixed;
      }
      draw(t);
    },
  };
}
