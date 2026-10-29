import { Key } from '@town/shared';

const BINDINGS: Record<string, number> = {
  KeyW: Key.Forward,
  KeyS: Key.Back,
  KeyA: Key.Left,
  KeyD: Key.Right,
  ShiftLeft: Key.Sprint,
  Space: Key.Jump,
  KeyR: Key.Reload,
  KeyE: Key.Interact,
};

/** Tracks held keys as the bitmask the server understands. */
export class Keyboard {
  keys = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.set(e.code, true));
    target.addEventListener('keyup', (e) => this.set(e.code, false));
    target.addEventListener('blur', () => (this.keys = 0));
  }

  private set(code: string, down: boolean): void {
    const bit = BINDINGS[code];
    if (bit === undefined) return;
    this.keys = down ? this.keys | bit : this.keys & ~bit;
  }
}
