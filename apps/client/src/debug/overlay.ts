import { BUDGETS } from '@town/shared';

export interface DebugStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  pingMs: number;
  renderer: string;
  serverTick: number;
  chunks?: number;
  zone?: string;
  tickMs?: number;
  locomotion?: string;
  physicsStepMs?: number;
  physicsStepMaxMs?: number;
  chunkLoadMs?: number;
  downloadMb?: number;
}

const enabled = location.pathname.startsWith('/debug') || location.search.includes('debug');

/** `/debug` (or `?debug`) overlay comparing live numbers against the Phase 0 budgets. */
export class DebugOverlay {
  private el?: HTMLPreElement;
  private frames = 0;
  private acc = 0;
  fps = 0;

  constructor() {
    if (!enabled) return;
    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      margin: '0',
      padding: '8px 10px',
      background: 'rgba(30,20,10,.75)',
      color: '#ffe9c7',
      font: '12px/1.4 ui-monospace, monospace',
      borderRadius: '6px',
      pointerEvents: 'none',
      zIndex: '10',
    });
    this.el.dataset.testid = 'debug-overlay';
    document.body.appendChild(this.el);
  }

  /** Call once per rendered frame with the frame's duration in seconds. */
  frame(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
    }
  }

  show(s: DebugStats): void {
    if (!this.el) return;
    const mark = (ok: boolean) => (ok ? '✓' : '✗');
    const opt = (v: number | undefined, unit: string) =>
      v === undefined ? '—' : `${v.toFixed(2)} ${unit}`;
    this.el.textContent = [
      `renderer     ${s.renderer}`,
      `fps          ${s.fps.toFixed(0).padStart(4)}  ${mark(s.fps >= BUDGETS.fps - 1)} ≥${BUDGETS.fps}`,
      `frame        ${s.frameMs.toFixed(2)} ms`,
      `draw calls   ${String(s.drawCalls).padStart(4)}  ${mark(s.drawCalls <= BUDGETS.drawCalls)} ≤${BUDGETS.drawCalls}`,
      `physics p95  ${opt(s.physicsStepMs, 'ms')}  (≤${BUDGETS.physicsStepMs} per step, server; max ${opt(s.physicsStepMaxMs, 'ms')})`,
      `chunk load   ${opt(s.chunkLoadMs, 'ms')}  (≤${BUDGETS.chunkLoadMs})`,
      `download     ${opt(s.downloadMb, 'MB')}  (≤${BUDGETS.initialDownloadMb})`,
      `chunks       ${s.chunks ?? '—'}`,
      `anim         ${s.locomotion ?? '—'}`,
      `zone         ${s.zone || '—'}   tick p95 ${opt(s.tickMs, 'ms')}`,
      `ping         ${s.pingMs.toFixed(0)} ms`,
      `server tick  ${s.serverTick}`,
    ].join('\n');
  }
}
