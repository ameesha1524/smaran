// Top-level orchestrator. Wires the renderer, clock, input and world together,
// owns the requestAnimationFrame loop, and delegates all content to the Scene.
// Deliberately thin — game logic lives in systems and scene elements, not here.

import { Clock } from "./Clock";
import { Input } from "./Input";
import { Renderer } from "./Renderer";
import { World } from "./World";
import { Scene } from "../world/Scene";
import { C } from "../config/theme";
import type { FrogSessionReport } from "../cognitive/report";

export class Game {
  private readonly renderer: Renderer;
  private readonly clock = new Clock();
  private readonly input: Input;
  private readonly world: World;
  private readonly scene: Scene;

  private running = false;
  private booted = false;
  private sessionBegun = false;
  private sessionEnded = false;
  private readonly onFirstFrame?: () => void;
  private readonly onTick?: (bugsFixed: number) => void;
  private readonly onSessionEnd?: (report: FrogSessionReport) => void;

  constructor(
    canvas: HTMLCanvasElement,
    onFirstFrame?: () => void,
    onTick?: (bugsFixed: number) => void,
    onSessionEnd?: (report: FrogSessionReport) => void
  ) {
    this.renderer = new Renderer(canvas, { targetHeight: 232 });
    this.input = new Input(canvas);
    this.world = new World(this.input);
    this.onFirstFrame = onFirstFrame;
    this.onTick = onTick;
    this.onSessionEnd = onSessionEnd;

    this.syncViewport(this.renderer.width, this.renderer.height);
    this.scene = new Scene(this.world);
    this.renderer.onResize((w, h) => {
      this.syncViewport(w, h);
      this.scene.relayout(this.world);
    });

    // Pause the loop when the tab is hidden — no point simulating an unseen
    // pond, and it keeps the delta clamp honest on return.
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private disposed = false;

  private onVisibility = (): void => {
    if (this.disposed) return;
    if (document.hidden) this.stop();
    else this.start();
  };

  /** Tear down for good: stop the loop and drop every global listener. Call
   *  after endSession() when the host (e.g. a React screen) unmounts. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.renderer.dispose();
  }

  private syncViewport(w: number, h: number): void {
    this.world.width = w;
    this.world.height = h;
    this.input.setViewport(this.renderer.pixelSize, w, h);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    // Begin the cognitive session on the very first start (not on later resumes
    // after the tab is hidden — a paused loop is not a finished visit).
    if (!this.sessionBegun && !this.sessionEnded) {
      this.sessionBegun = true;
      this.scene.beginSession(this.world);
    }
    this.clock.tick(performance.now()); // reset delta baseline
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /**
   * End the visit and return the batch cognitive report (once). Smaran calls
   * this when the patient leaves the game screen; the standalone demo calls it
   * on page-hide. Returns null if there was no session or it already ended.
   */
  endSession(): FrogSessionReport | null {
    if (!this.sessionBegun || this.sessionEnded) return null;
    this.sessionEnded = true;
    const report = this.scene.endSession();
    this.onSessionEnd?.(report);
    return report;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.clock.tick(now);

    const world = this.world;
    world.t = this.clock.elapsed;
    world.dt = this.clock.delta;
    world.ctx = this.renderer.ctx;

    world.camera.update(world.t, world.dt, this.input);
    this.scene.update(world);

    this.renderer.clear(C.skyDeep);
    this.scene.render(world);

    this.onTick?.(world.progress.bugsResolved);

    if (!this.booted) {
      this.booted = true;
      this.onFirstFrame?.();
    }

    requestAnimationFrame(this.frame);
  };
}
