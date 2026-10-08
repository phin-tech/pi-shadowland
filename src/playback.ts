import { createHash } from "node:crypto";
import { createState, nextScene, formatScene, type Scene, type StoryState } from "./story.js";
import { parsePack, type StoryPack } from "./packs.js";

export interface SavedPlayback {
  version: 1;
  state: StoryState;
  pack?: StoryPack;
  packCursor: number;
  scenes: Record<string, Scene>;
  enabled: boolean;
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Story advancement and rendering are separate: redraws never consume a beat. */
export class Playback {
  private state = createState(42);
  private pack?: StoryPack;
  private packCursor = 0;
  private scenes = new Map<string, Scene>();
  enabled = true;

  constructor(saved?: SavedPlayback) {
    if (saved) {
      if (saved.version !== 1 || saved.state?.version !== 1 || !Number.isSafeInteger(saved.state.cursor) || saved.state.cursor < 0 || !Number.isSafeInteger(saved.state.seed) || !Number.isSafeInteger(saved.packCursor) || saved.packCursor < 0) throw new Error("Invalid saved Shadowland story state");
      this.state = { ...saved.state };
      this.pack = saved.pack ? parsePack(saved.pack) : undefined;
      this.packCursor = saved.packCursor;
      this.enabled = saved.enabled;
      // Reuse the same untrusted-content validator for saved scenes.
      for (const [key, scene] of Object.entries(saved.scenes)) {
        this.scenes.set(key, parsePack({ version: 1, id: "saved", title: "Saved", description: "Saved scene", characters: scene.characters, scenes: [scene] }).scenes[0]);
      }
    }
  }

  scene(key: string): Scene {
    const existing = this.scenes.get(key);
    if (existing) return existing;
    let scene: Scene;
    if (this.pack && this.packCursor < this.pack.scenes.length) {
      scene = this.pack.scenes[this.packCursor++];
    } else if (this.pack) {
      const last = this.pack.scenes[this.pack.scenes.length - 1];
      scene = {
        id: `${this.pack.id}-complete`, title: "Story pack complete",
        episode: last.episode, beat: last.beat + 1,
        canon: "This pack is complete. No further plot developments are asserted.",
        characters: this.pack.characters,
        lines: this.pack.characters.map((character, index) => ({
          speaker: character.name,
          text: index === 0 ? "Our tale rests here." : "Until the next story begins.",
        })),
      };
    } else {
      const next = nextScene(this.state);
      this.state = next.state;
      scene = next.scene;
    }
    this.scenes.set(key, scene);
    return scene;
  }

  render(key: string): string { return formatScene(this.scene(key)); }

  usePack(pack: StoryPack): void {
    this.pack = parsePack(pack);
    this.packCursor = 0;
  }

  snapshot(): SavedPlayback {
    return { version: 1, state: { ...this.state }, pack: this.pack, packCursor: this.packCursor, scenes: Object.fromEntries(this.scenes), enabled: this.enabled };
  }

  status(): string {
    return `${this.enabled ? "on" : "off"} · ${this.pack ? `${this.pack.title}: ${Math.min(this.packCursor, this.pack.scenes.length)}/${this.pack.scenes.length}` : "authored/madlib campaign"} · ${this.scenes.size} exchanges`;
  }
}
