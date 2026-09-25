// The floating info widget (the DOM panel in index.html). It's the one piece of
// non-canvas UI — a lightweight glass card that tells a first-time visitor what
// this is, shows the running Bugs Fixed count, and toggles sound. Kept dumb: the
// game pushes it the count each frame; it owns nothing but its own DOM.

import { ambience } from "../audio/Ambience";

export class Panel {
  private readonly root: HTMLElement | null;
  private readonly countEl: HTMLElement | null;
  private readonly muteBtn: HTMLButtonElement | null;
  private lastCount = -1;

  constructor() {
    this.root = document.getElementById("panel");
    this.countEl = document.getElementById("bugCount");
    this.muteBtn = document.getElementById("muteBtn") as HTMLButtonElement | null;

    this.muteBtn?.addEventListener("click", () => {
      ambience.toggleMute();
      this.reflectMute();
    });
    this.reflectMute();
  }

  /** Fade the widget in once the pond is showing. */
  reveal(): void {
    this.root?.classList.add("ready");
  }

  /** Push the live catch count (only touches the DOM when it changes). */
  setBugs(n: number): void {
    if (n === this.lastCount || !this.countEl) return;
    this.lastCount = n;
    this.countEl.textContent = String(n);
  }

  private reflectMute(): void {
    if (!this.muteBtn) return;
    const muted = ambience.isMuted;
    this.muteBtn.textContent = muted ? "🔇" : "🔊";
    this.muteBtn.classList.toggle("muted", muted);
  }
}
