/** Interaction prompt ("E  Enter …") and a fade used when switching spaces. Plain DOM. */
export class PromptHud {
  private readonly el = document.createElement('div');
  private readonly fade = document.createElement('div');
  private text = '';

  constructor() {
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '8px',
      background: 'rgba(30,20,10,.72)',
      color: '#fff3dc',
      font: '600 15px/1.2 system-ui, sans-serif',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '5',
    });
    this.el.dataset.testid = 'interact-prompt';
    Object.assign(this.fade.style, {
      position: 'fixed',
      inset: '0',
      background: '#1e140a',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 160ms ease',
      zIndex: '8',
    });
    document.body.append(this.el, this.fade);
  }

  show(prompt: string | undefined): void {
    const next = prompt ?? '';
    if (next === this.text) return;
    this.text = next;
    this.el.style.display = next ? 'block' : 'none';
    this.el.innerHTML = '';
    if (!next) return;
    const key = document.createElement('kbd');
    key.textContent = 'E';
    Object.assign(key.style, {
      display: 'inline-block',
      minWidth: '1.4em',
      marginRight: '8px',
      padding: '1px 6px',
      borderRadius: '4px',
      background: '#fff3dc',
      color: '#1e140a',
      textAlign: 'center',
    });
    this.el.append(key, document.createTextNode(next));
  }

  get current(): string {
    return this.text;
  }

  /** Dip to dark, run the swap, fade back in. */
  async transition(swap: () => Promise<void> | void): Promise<void> {
    this.fade.style.opacity = '1';
    await new Promise((r) => setTimeout(r, 170));
    try {
      await swap();
    } finally {
      this.fade.style.opacity = '0';
    }
  }
}
