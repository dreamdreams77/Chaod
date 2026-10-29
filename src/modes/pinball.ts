/** FLIPPER FRENZY (placeholder until the real mode lands). */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';

export class PinballMode extends ModeBase {
  id = 'pinball';
  hp = 3;
  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'pinball', opts);
  }
  directorContext(): DirectorContext {
    return { hpFrac: 1, safe: true, bossActive: false };
  }
  heal(): void {}
  update(dt: number): void {
    this.tickShared(dt);
  }
  draw(): void {}
}
