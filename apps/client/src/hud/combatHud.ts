import { PLAYER } from '@town/shared';

/** Crosshair, health, ammo, hit marker and the knocked-out notice. Plain DOM, updated only on change. */
export class CombatHud {
  private readonly root = document.createElement('div');
  private readonly cross = document.createElement('div');
  private readonly health = document.createElement('div');
  private readonly healthFill = document.createElement('div');
  private readonly ammo = document.createElement('div');
  private readonly down = document.createElement('div');
  private hitUntil = 0;
  private last = '';

  constructor() {
    const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);
    css(this.root, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '4',
      font: '600 14px/1.2 system-ui, sans-serif',
      color: '#fff3dc',
    });
    css(this.cross, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '18px',
      height: '18px',
      margin: '-9px 0 0 -9px',
      backgroundImage: 'linear-gradient(#fff3dc,#fff3dc),linear-gradient(#fff3dc,#fff3dc)',
      backgroundSize: '2px 18px, 18px 2px',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      opacity: '0.85',
      transition: 'transform 80ms',
    });
    css(this.health, {
      position: 'absolute',
      left: '16px',
      bottom: '40px',
      width: '220px',
      height: '12px',
      background: 'rgba(30,20,10,.6)',
      borderRadius: '6px',
      overflow: 'hidden',
    });
    css(this.healthFill, {
      height: '100%',
      width: '100%',
      background: '#e2572b',
      transition: 'width 120ms',
    });
    this.health.append(this.healthFill);
    css(this.ammo, {
      position: 'absolute',
      right: '20px',
      bottom: '36px',
      fontSize: '22px',
      textAlign: 'right',
      textShadow: '0 1px 2px #0008',
    });
    css(this.down, {
      position: 'absolute',
      left: '50%',
      top: '38%',
      transform: 'translateX(-50%)',
      fontSize: '20px',
      padding: '10px 16px',
      background: 'rgba(30,20,10,.7)',
      borderRadius: '8px',
      display: 'none',
    });
    this.down.textContent = 'Knocked out — back on your feet shortly…';
    this.ammo.dataset.testid = 'ammo';
    this.health.dataset.testid = 'health';
    this.root.append(this.cross, this.health, this.ammo, this.down);
    document.body.append(this.root);
  }

  /** Call every frame. */
  update(s: {
    health: number;
    weapon: string;
    mag: number;
    reserve: number;
    reloading: boolean;
    armed: boolean;
  }): void {
    const now = performance.now();
    this.cross.style.transform = now < this.hitUntil ? 'rotate(45deg) scale(1.3)' : 'none';
    this.cross.style.filter = now < this.hitUntil ? 'drop-shadow(0 0 3px #ff4d2e)' : 'none';
    const key = `${s.health}|${s.weapon}|${s.mag}|${s.reserve}|${s.reloading}|${s.armed}`;
    if (key === this.last) return;
    this.last = key;
    this.healthFill.style.width = `${(100 * s.health) / PLAYER.maxHealth}%`;
    this.ammo.textContent = s.armed
      ? `${s.weapon}  ${s.reloading ? 'reloading…' : `${s.mag} / ${s.reserve}`}`
      : '';
    this.cross.style.display = s.armed && s.health > 0 ? 'block' : 'none';
    this.down.style.display = s.health > 0 ? 'none' : 'block';
  }

  dispose(): void {
    this.root.remove();
  }

  hitMarker(): void {
    this.hitUntil = performance.now() + 140;
  }
}
