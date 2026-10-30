import type { HitKind } from '@town/shared';

export interface Hittable {
  kind: Exclude<HitKind, 'none' | 'world'>;
  id: string;
  /** Apply damage; `by` is the shooter's session id. */
  damage?(amount: number, by: string): void;
}

/** Collider handle → what it belongs to. Anything not registered counts as world geometry. */
export class HitRegistry {
  private readonly byHandle = new Map<number, Hittable>();

  add(handle: number, h: Hittable): void {
    this.byHandle.set(handle, h);
  }

  remove(handle: number): void {
    this.byHandle.delete(handle);
  }

  get(handle: number): Hittable | undefined {
    return this.byHandle.get(handle);
  }
}
