import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer | import('three/webgpu').WebGPURenderer;
  kind: 'webgl2' | 'webgpu';
  drawCalls(): number;
}

/** WebGL2 by default; WebGPU behind `?gpu=1`, falling back to WebGL2 if unavailable. */
export async function createRenderer(container: HTMLElement): Promise<RendererHandle> {
  const wantGpu = new URLSearchParams(location.search).get('gpu') === '1';
  let handle: RendererHandle | undefined;

  if (wantGpu && 'gpu' in navigator) {
    const { WebGPURenderer } = await import('three/webgpu');
    const renderer = new WebGPURenderer({ antialias: true });
    await renderer.init();
    handle = { renderer, kind: 'webgpu', drawCalls: () => renderer.info.render.drawCalls };
  }
  if (!handle) {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    handle = { renderer, kind: 'webgl2', drawCalls: () => renderer.info.render.calls };
  }

  const r = handle.renderer;
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(container.clientWidth, container.clientHeight);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(r.domElement);
  return handle;
}
