/**
 * Action-based input with remappable keyboard bindings and optional touch buttons.
 * Game code never reads raw keys; it asks about Actions.
 */
export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'pause', 'confirm', 'back'] as const;
export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string[]>;

export const ACTION_LABELS: Record<Action, string> = {
  left: 'MOVE LEFT',
  right: 'MOVE RIGHT',
  up: 'UP / INTERACT',
  down: 'DOWN / BLOCK',
  jump: 'JUMP / BOOST',
  attack: 'ATTACK',
  special: 'SPECIAL',
  pause: 'PAUSE',
  confirm: 'CONFIRM',
  back: 'BACK',
};

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['KeyZ', 'Space', 'KeyJ'],
  attack: ['KeyX', 'KeyK'],
  special: ['KeyC', 'KeyL'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'KeyZ', 'Space'],
  back: ['Escape', 'Backspace', 'KeyX'],
};

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
    Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP',
    ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL', Tab: 'TAB',
  };
  return map[code] ?? code.toUpperCase();
}

export class Input {
  bindings: Bindings;
  private down = new Set<string>();
  private pressedKeys = new Set<string>();
  private releasedKeys = new Set<string>();
  private touchDown = new Set<Action>();
  private touchPressed = new Set<Action>();
  private touchReleased = new Set<Action>();
  /** Characters typed this frame (for secret codes / seed entry). */
  typed = '';
  private typedBuf = '';
  /** When set, the next key press is delivered here instead of to the game (for remapping). */
  captureNext: ((code: string) => void) | null = null;
  anyKeyThisFrame = false;
  private anyBuf = false;
  usingTouch = false;

  constructor(bindings: Bindings) {
    this.bindings = cloneBindings(bindings);
  }

  attach(target: Window): () => void {
    const kd = (e: KeyboardEvent) => {
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        return;
      }
      if (isGameKey(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressedKeys.add(e.code);
        this.anyBuf = true;
        if (e.key.length === 1) this.typedBuf += e.key.toUpperCase();
      }
    };
    const ku = (e: KeyboardEvent) => {
      this.down.delete(e.code);
      this.releasedKeys.add(e.code);
    };
    const blur = () => this.clearAll();
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', kd);
      target.removeEventListener('keyup', ku);
      target.removeEventListener('blur', blur);
    };
  }

  /** Called once per simulation step, before the game reads input. */
  beginFrame(): void {
    this.typed = this.typedBuf;
    this.typedBuf = '';
    this.anyKeyThisFrame = this.anyBuf;
    this.anyBuf = false;
  }
  /** Called once per simulation step, after the game has read input. */
  endFrame(): void {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.touchPressed.clear();
    this.touchReleased.clear();
  }

  clearAll(): void {
    this.down.clear();
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.touchDown.clear();
  }

  held(a: Action): boolean {
    if (this.touchDown.has(a)) return true;
    for (const k of this.bindings[a]) if (this.down.has(k)) return true;
    return false;
  }
  pressed(a: Action): boolean {
    if (this.touchPressed.has(a)) return true;
    for (const k of this.bindings[a]) if (this.pressedKeys.has(k)) return true;
    return false;
  }
  released(a: Action): boolean {
    if (this.touchReleased.has(a)) return true;
    for (const k of this.bindings[a]) if (this.releasedKeys.has(k)) return true;
    return false;
  }
  axisX(): number {
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }
  axisY(): number {
    return (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
  }

  /** Programmatic input (touch buttons, automated tests). */
  setVirtual(a: Action, isDown: boolean): void {
    if (isDown && !this.touchDown.has(a)) {
      this.touchDown.add(a);
      this.touchPressed.add(a);
      this.anyBuf = true;
    } else if (!isDown && this.touchDown.has(a)) {
      this.touchDown.delete(a);
      this.touchReleased.add(a);
    }
  }

  rebind(a: Action, slot: number, code: string): void {
    const list = this.bindings[a].slice();
    // A key may only drive one gameplay action at a time (menu actions may overlap).
    const gameplay: Action[] = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'pause'];
    if (gameplay.includes(a)) {
      for (const other of gameplay) {
        if (other !== a) this.bindings[other] = this.bindings[other].filter((k) => k !== code);
      }
    }
    list[slot] = code;
    this.bindings[a] = Array.from(new Set(list.filter(Boolean)));
  }
}

export function cloneBindings(b: Bindings): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = (b[a] ?? DEFAULT_BINDINGS[a]).slice();
  return out;
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space' || code === 'Backspace' || code === 'Tab';
}

/** Builds a minimal on-screen gamepad for touch devices. */
export function setupTouch(root: HTMLElement, input: Input): void {
  const layout: Array<[Action, string, string]> = [
    ['left', '◀', 'left:12px;bottom:70px'],
    ['right', '▶', 'left:132px;bottom:70px'],
    ['up', '▲', 'left:72px;bottom:130px'],
    ['down', '▼', 'left:72px;bottom:12px'],
    ['jump', 'A', 'right:12px;bottom:40px'],
    ['attack', 'B', 'right:76px;bottom:90px'],
    ['special', 'C', 'right:140px;bottom:40px'],
    ['pause', 'II', 'right:12px;top:12px'],
  ];
  for (const [action, label, pos] of layout) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('style', pos);
    const on = (e: Event) => {
      e.preventDefault();
      b.classList.add('active');
      input.setVirtual(action, true);
      if (action === 'jump') input.setVirtual('confirm', true);
      if (action === 'pause') input.setVirtual('back', true);
    };
    const off = (e: Event) => {
      e.preventDefault();
      b.classList.remove('active');
      input.setVirtual(action, false);
      if (action === 'jump') input.setVirtual('confirm', false);
      if (action === 'pause') input.setVirtual('back', false);
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
    root.appendChild(b);
  }
  const enable = () => {
    input.usingTouch = true;
    root.classList.add('on');
  };
  window.addEventListener('touchstart', enable, { once: true, passive: true });
}
