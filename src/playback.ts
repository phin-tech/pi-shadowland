import { createHash, randomUUID } from "node:crypto";
import { createState, nextScene, formatScene, formatScenePlain } from "./story.js";
import { parsePack, parseCast, parseScene } from "./packs.js";
import { LorelineRuntime, parseLorelineStory } from "./loreline.js";
import type { Scene, StoryState } from "./story.js";
import type { StoryPack } from "./packs.js";
import type { LorelineStory, LorelineCheckpoint, StorySource } from "./loreline.js";

export interface StoryView {
  title: string;
  scene: Scene;
  history: Scene[];
  enabled: boolean;
  complete: boolean;
  generation: number;
  error?: string;
}

export interface SavedPlayback {
  version: 1;
  state: StoryState;
  pack?: StoryPack;
  packCursor: number;
  scenes: Record<string, Scene>;
  recentKeys?: string[];
  enabled: boolean;
  loreline?: { story: LorelineStory; checkpoint?: LorelineCheckpoint; ready?: Scene; current?: Scene; failure?: string };
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Redraws reuse recorded exchanges; interpreted stories prefetch outside rendering. */
export class Playback {
  private state = createState(42);
  private pack?: StoryPack;
  private packCursor = 0;
  private scenes = new Map<string, Scene>();
  private recentKeys: string[] = [];
  private generation = 0;
  private loreline?: SavedPlayback["loreline"];
  private runtime?: LorelineRuntime;
  private preparing?: Promise<void>;
  private selecting = false;
  enabled = true;
  onChange?: (error?: string) => void;

  constructor(saved?: SavedPlayback) {
    if (!saved) return;
    if (saved.version !== 1 || saved.state?.version !== 1 || !Number.isSafeInteger(saved.state.cursor) || saved.state.cursor < 0 || !Number.isSafeInteger(saved.state.seed) || !Number.isSafeInteger(saved.packCursor) || saved.packCursor < 0) throw new Error("Invalid saved Shadowland story state");
    this.state = { ...saved.state };
    this.pack = saved.pack ? parsePack(saved.pack) : undefined;
    this.packCursor = saved.packCursor;
    this.enabled = saved.enabled;
    for (const [key, scene] of Object.entries(saved.scenes)) this.scenes.set(key, parseScene(scene, parseCast(scene.characters)));
    if (saved.loreline) {
      const data = saved.loreline;
      this.loreline = {
        story: parseLorelineStory(data.story), checkpoint: data.checkpoint, failure: data.failure,
        ready: data.ready ? parseScene(data.ready, parseCast(data.ready.characters)) : undefined,
        current: data.current ? parseScene(data.current, parseCast(data.current.characters)) : undefined,
      };
    }
    this.recentKeys = (saved.recentKeys ?? [...this.scenes.keys()]).filter(key => this.scenes.has(key)).slice(-30);
  }

  async initialize(): Promise<void> {
    if (!this.loreline || this.runtime || this.loreline.failure) return;
    if (this.loreline.checkpoint?.finished && (this.loreline.ready || this.loreline.current)) return;
    this.runtime = new LorelineRuntime(this.loreline.story, this.loreline.checkpoint);
    if (!this.loreline.ready && !this.loreline.current?.choices) {
      const result = await this.runtime.next();
      this.loreline.ready = result.scene;
      this.loreline.checkpoint = result.checkpoint;
    }
  }

  private prepare(): void {
    const data = this.loreline;
    const runtime = this.runtime;
    if (!data || !runtime || data.ready || data.current?.choices || data.checkpoint?.finished || data.failure || this.preparing) return;
    this.preparing = runtime.next().then(result => {
      data.ready = result.scene;
      data.checkpoint = result.checkpoint;
    }).catch(error => {
      data.failure = String(error);
    }).finally(() => {
      this.preparing = undefined;
      this.onChange?.(data.failure);
    });
  }

  scene(key: string): Scene {
    const existing = this.scenes.get(key);
    if (existing) return existing;
    let scene: Scene;
    if (this.loreline) {
      const data = this.loreline;
      const available = data.ready ?? data.current;
      if (!available) throw new Error("Initialize Loreline before rendering");
      scene = available;
      data.current = scene;
      data.ready = undefined;
      this.prepare();
    } else if (this.pack && this.packCursor < this.pack.scenes.length) {
      scene = this.pack.scenes[this.packCursor++];
    } else if (this.pack) {
      const last = this.pack.scenes[this.pack.scenes.length - 1];
      const speakers = [...new Set(last.lines.map(line => line.speaker))].slice(0, 2);
      scene = {
        id: `${this.pack.id}-complete`, title: "Story pack complete",
        episode: last.episode, beat: last.beat + 1,
        canon: "This pack is complete. No further plot developments are asserted.",
        characters: this.pack.characters,
        lines: speakers.map((speaker, index) => ({ speaker, text: index === 0 ? "Our tale rests here." : "Until the next story begins." })),
      };
    } else {
      const next = nextScene(this.state);
      this.state = next.state;
      scene = next.scene;
    }
    this.scenes.set(key, scene);
    const last = this.scenes.get(this.recentKeys.at(-1) ?? "");
    if (last?.id !== scene.id) {
      this.recentKeys.push(key);
      if (this.recentKeys.length > 30) this.recentKeys.shift();
    }
    return scene;
  }

  render(key: string): string { return formatScene(this.scene(key)); }

  usePack(pack: StoryPack): void {
    if (this.runtime) throw new Error("Use useStory to switch away from a running Loreline story");
    this.loreline = undefined;
    this.recentKeys = [];
    this.generation++;
    this.pack = parsePack(pack);
    this.packCursor = 0;
  }

  async useStory(source: StorySource): Promise<void> {
    // Validate and run a new source before discarding the current story.
    if ("format" in source) {
      const story = parseLorelineStory(source);
      const runtime = new LorelineRuntime(story);
      try {
        const result = await runtime.next();
        await this.close();
        this.pack = undefined;
        this.recentKeys = [];
        this.generation++;
        this.loreline = { story, ready: result.scene, checkpoint: result.checkpoint };
        this.runtime = runtime;
      } catch (error) { await runtime.close(); throw error; }
    } else {
      const pack = parsePack(source);
      await this.close();
      this.usePack(pack);
    }
  }

  async choose(index: number, choiceId?: string): Promise<string> {
    if (this.selecting) throw new Error("A story choice is already in progress");
    await this.preparing;
    if (this.selecting) throw new Error("A story choice is already in progress");
    const data = this.loreline;
    const scene = data?.current?.choices ? data.current : !data?.current ? data?.ready : undefined;
    if (!data || !scene?.choices || !this.runtime) throw new Error("The story is not waiting for a displayed choice");
    if (choiceId !== undefined && scene.choiceId !== choiceId) throw new Error("That choice is no longer current");
    const option = scene.choices[index - 1];
    if (!Number.isSafeInteger(index) || !option?.enabled) throw new Error("Choose an enabled option from the displayed list");
    const runtime = this.runtime;
    this.selecting = true;
    try {
      if (!data.current) this.scene(`window:${randomUUID()}`);
      const result = await runtime.choose(index - 1, scene.choiceId);
      data.ready = result.scene;
      data.current = undefined;
      data.checkpoint = result.checkpoint;
      data.failure = undefined;
      this.onChange?.();
      return option.text;
    } catch (error) {
      await runtime.close();
      if (this.runtime === runtime) this.runtime = undefined;
      if (this.loreline === data) { data.failure = String(error); this.onChange?.(data.failure); }
      throw error;
    } finally { this.selecting = false; }
  }

  /** Manual window progression uses the same cursor as agent-driven dialogue. */
  async advance(sceneId?: string, generation?: number): Promise<void> {
    const before = this.view();
    if ((sceneId !== undefined && before.scene.id !== sceneId) || (generation !== undefined && before.generation !== generation)) throw new Error("The story changed; use the current controls");
    if (before.scene.choices) throw new Error("Choose a branch before continuing");
    if (before.complete || before.error) throw new Error("The story has ended or stopped");
    if (!this.recentKeys.length || (this.loreline?.ready && !this.loreline.current)) this.scene(`window:${randomUUID()}`);
    this.prepare();
    await this.preparing;
    if (this.generation !== before.generation) throw new Error("The story changed; use the current controls");
    if (this.loreline?.failure) throw new Error(this.loreline.failure);
    this.scene(`window:${randomUUID()}`);
    this.onChange?.();
  }

  view(): StoryView {
    const data = this.loreline;
    const history = this.recentKeys.map(key => this.scenes.get(key)!);
    const scene = data?.current ?? data?.ready ?? history.at(-1) ?? this.pack?.scenes[this.packCursor] ?? nextScene(this.state).scene;
    const complete = data ? !!data.checkpoint?.finished && (!data.ready || data.ready.id === scene.id) : this.pack !== undefined && this.packCursor >= this.pack.scenes.length;
    return { title: data?.story.title ?? this.pack?.title ?? "Ghost Wire", scene, history, enabled: this.enabled, complete, generation: this.generation, error: data?.failure };
  }

  async close(): Promise<void> {
    await this.preparing;
    await this.runtime?.close();
    this.runtime = undefined;
  }

  snapshot(): SavedPlayback {
    return { version: 1, state: { ...this.state }, pack: this.pack, packCursor: this.packCursor, scenes: Object.fromEntries(this.scenes), recentKeys: [...this.recentKeys], enabled: this.enabled, loreline: this.loreline ? structuredClone(this.loreline) : undefined };
  }

  status(): string {
    const data = this.loreline;
    const progress = data ? `${data.story.title} · beat ${data.checkpoint?.cursor ?? 0}${data.checkpoint?.finished ? " · complete" : ""}${data.failure ? ` · stopped: ${data.failure}` : ""}` : this.pack ? `${this.pack.title}: ${Math.min(this.packCursor, this.pack.scenes.length)}/${this.pack.scenes.length}` : "authored/madlib campaign";
    const choice = data?.current?.choices ? data.current : !data?.current ? data?.ready : undefined;
    return `${this.enabled ? "on" : "off"} · ${progress} · ${this.scenes.size} exchanges${choice?.choices ? `\n\n${formatScenePlain(choice)}` : ""}`;
  }
}
