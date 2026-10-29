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

/**
 * Tracks held keys as the bitmask the server understands. Input is sampled once per 50 ms tick,
 * so a quick tap would fall between samples: taps are latched until the next sample().
 */
export class Keyboard {
  private held = 0;
  private tapped = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.set(e.code, true));
    target.addEventListener('keyup', (e) => this.set(e.code, false));
    target.addEventListener('blur', () => (this.held = this.tapped = 0));
  }

  /** Keys for this tick: everything held now plus anything pressed since the last sample. */
  sample(): number {
    const keys = this.held | this.tapped;
    this.tapped = 0;
    return keys;
  }

  private set(code: string, down: boolean): void {
    const bit = BINDINGS[code];
    if (bit === undefined) return;
    if (down) {
      this.held |= bit;
      this.tapped |= bit;
    } else {
      this.held &= ~bit;
    }
  }
}
