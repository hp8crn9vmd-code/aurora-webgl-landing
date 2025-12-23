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

  let w = 0, h = 0, dpr = 1;
  let mx = 0.5, my = 0.5;

  function rebuildBounds() {
    bounds.forEach((b) => Composite.remove(world, b));
    const thick = 120;
    bounds = [
      Bodies.rectangle(w / 2, -thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w / 2, h + thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(-thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w + thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
    ];
    Composite.add(world, bounds);
  }

  function rebuildBodies() {
    bodies.forEach((b) => Composite.remove(world, b));
    constraints.forEach((c) => Composite.remove(world, c));
    bodies = [];
    constraints = [];

    for (let i = 0; i < cfg.count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 10 + Math.random() * 18;

      const isCircle = Math.random() < 0.55;
      const b = isCircle
        ? Bodies.circle(x, y, r, { restitution: cfg.restitution, frictionAir: cfg.frictionAir, density: cfg.density })
        : Bodies.polygon(x, y, 3 + Math.floor(Math.random() * 5), r, { restitution: cfg.restitution, frictionAir: cfg.frictionAir, density: cfg.density });

      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.1);
      Body.setVelocity(b, { x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.5) * 2.4 });

      bodies.push(b);
    }

    const links = Math.floor(cfg.count * cfg.constraintRatio);
    for (let i = 0; i < links; i++) {
      const a = bodies[Math.floor(Math.random() * bodies.length)];
      const b = bodies[Math.floor(Math.random() * bodies.length)];
      if (a === b) continue;

      const c = Constraint.create({
        bodyA: a,
        bodyB: b,
        stiffness: lerp(0.002, 0.006, Math.random()),
        damping: lerp(0.08, 0.16, Math.random()),
        length: lerp(60, 200, Math.random()),
        render: { visible: false },
      });
      constraints.push(c);
    }

    Composite.add(world, bodies);
    Composite.add(world, constraints);
  }

  function applyForces(t: number) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const px = b.position.x * 0.004;
      const py = b.position.y * 0.004;

      const nx = noise2(px + t * 0.35, py) - 0.5;
      const ny = noise2(px, py + t * 0.35) - 0.5;

      Body.applyForce(b, b.position, { x: nx * cfg.turbulence, y: ny * cfg.turbulence });

      // mouse force (soft)
      const dx = (b.position.x / w) - mx;
      const dy = (b.position.y / h) - my;
      const dist = Math.sqrt(dx * dx + dy * dy) * Math.max(w, h);
      const r = cfg.mouseRadius;

      if (dist < r) {
        const s = (1 - dist / r) * cfg.mouseForce;
        Body.applyForce(b, b.position, { x: -dx * s, y: -dy * s });
      }

      if (Math.random() < cfg.impulseChance) {
        Body.applyForce(b, b.position, {
          x: (Math.random() - 0.5) * cfg.impulseStrength,
          y: (Math.random() - 0.5) * cfg.impulseStrength,
        });
        Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.22);
      }
    }
  }

  // fixed-step stability
  let acc = 0;
  const fixed = 1 / 60;

  function draw() {
    if (!cfg.trails) g.clearRect(0, 0, w, h);
    else {
      g.fillStyle = `rgba(0,0,0,${cfg.trailFade})`;
      g.fillRect(0, 0, w, h);
    }

    for (const b of bodies) {
      const x = b.position.x;
      const y = b.position.y;
      const angle = b.angle;
      const r = clamp((b.bounds.max.x - b.bounds.min.x) * 0.35, 10, 28);

      const grad = g.createRadialGradient(x, y, 0, x, y, r * 2.5);
      grad.addColorStop(0, "rgba(255,255,255,0.06)");
      grad.addColorStop(1, "rgba(255,255,255,0.00)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 2.5, 0, Math.PI * 2);
      g.fill();

      g.save();
      g.translate(x, y);
      g.rotate(angle);

      g.fillStyle = "rgba(255,255,255,0.045)";
      g.strokeStyle = "rgba(255,255,255,0.10)";
      g.lineWidth = 1;

      const verts = b.vertices;
      g.beginPath();
      g.moveTo(verts[0].x - x, verts[0].y - y);
      for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x - x, verts[i].y - y);
      g.closePath();
      g.fill();
      g.stroke();

      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.6);
      g.lineTo(r * 0.2, -r * 0.9);
      g.stroke();

      g.restore();
    }
  }

  return {
    resize: (W: number, H: number, DPR: number) => {
      w = W; h = H; dpr = DPR;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      rebuildBounds();
      rebuildBodies();
    },
    setMouse: (MX: number, MY: number) => {
      mx = (MX / Math.max(w, 1));
      my = (MY / Math.max(h, 1));
    },
    step: (t: number, dt: number) => {
      acc += dt;
      acc = Math.min(acc, 0.2);
      while (acc >= fixed) {
        applyForces(t);
        Engine.update(engine, fixed * 1000);
        acc -= fixed;
      }
      draw();
    },
  };
}
