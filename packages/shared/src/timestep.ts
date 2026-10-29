/**
 * Fixed-timestep accumulator. Feed it real frame time; it tells you how many fixed steps
 * to run and the leftover fraction to interpolate rendering with.
 */
export class FixedTimestep {
  private acc = 0;
  constructor(
    readonly dt: number,
    /** Cap on steps per frame so a long stall can't spiral. */
    private readonly maxSteps = 5,
  ) {}

  advance(frameSeconds: number): { steps: number; alpha: number } {
    this.acc += Math.min(frameSeconds, this.dt * this.maxSteps);
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.acc -= this.dt;
      steps++;
    }
    return { steps, alpha: this.acc / this.dt };
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation in radians. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
