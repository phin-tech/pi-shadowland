import { Worker } from "node:worker_threads";
import { basename } from "node:path";
import { loadSource, parsePack, parseCast, parseScene } from "./packs.js";
import type { StoryPack } from "./packs.js";
import type { Scene } from "./story.js";

export interface LorelineStory {
  format: "loreline";
  version: 1;
  id: string;
  title: string;
  description: string;
  source: string;
}
export interface LorelineCheckpoint {
  data: unknown;
  cursor: number;
  finished: boolean;
  rng: number;
}
export interface LorelineResult { scene: Scene; checkpoint: LorelineCheckpoint }
export type StorySource = StoryPack | LorelineStory;

export function parseLorelineStory(value: unknown): LorelineStory {
  if (!value || typeof value !== "object") throw new Error("Invalid Loreline story");
  const story = value as Record<string, unknown>;
  if (story.format !== "loreline" || story.version !== 1 || typeof story.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(story.id) || typeof story.title !== "string" || !story.title.trim() || story.title.length > 160 || typeof story.description !== "string" || !story.description.trim() || story.description.length > 1200 || typeof story.source !== "string" || !story.source.trim() || Buffer.byteLength(story.source) > 1_048_576) throw new Error("Invalid Loreline story metadata or source (maximum 1 MiB)");
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(story.title + story.description)) throw new Error("Loreline metadata must not contain control characters");
  return { format: "loreline", version: 1, id: story.id, title: story.title, description: story.description, source: story.source };
}

export async function loadStory(source: string, signal?: AbortSignal): Promise<StorySource> {
  const data = await loadSource(source, signal);
  const path = /^https?:\/\//i.test(source) ? new URL(source).pathname : source;
  if (!/\.lor(?:\.txt)?$/i.test(path)) return parsePack(JSON.parse(data));
  const name = basename(path).replace(/\.lor(?:\.txt)?$/i, "");
  const id = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 64) || "story";
  return parseLorelineStory({ format: "loreline", version: 1, id, title: name || "Loreline story", description: "Interactive Loreline conversation", source: data });
}

/** Workers bound script execution time; they are not an OS security sandbox. */
export class LorelineRuntime {
  private worker: Worker;
  private serial = 0;
  private pending = new Map<number, { resolve(result: LorelineResult): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private failure?: Error;
  private closing?: Promise<void>;
  private exited = false;

  constructor(story: LorelineStory, checkpoint?: LorelineCheckpoint) {
    this.worker = new Worker(new URL("./loreline-worker.js", import.meta.url), { workerData: { story: parseLorelineStory(story), checkpoint }, env: {}, execArgv: [] });
    this.worker.on("message", (message: { id: number; result?: LorelineResult; error?: string }) => {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error || !message.result) { request.reject(new Error(message.error || "Loreline returned no result")); return; }
      try {
        const result = message.result;
        result.scene = parseScene(result.scene, parseCast(result.scene.characters));
        request.resolve(result);
      } catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
    });
    this.worker.on("error", error => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on("exit", code => { this.exited = true; if (!this.failure && this.pending.size) this.fail(new Error(`Loreline worker exited (${code})`)); });
  }

  next(): Promise<LorelineResult> { return this.request("next"); }
  choose(index: number, choiceId?: string): Promise<LorelineResult> { return this.request("choose", index, choiceId); }

  private request(action: string, index?: number, choiceId?: string): Promise<LorelineResult> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.serial;
    const { promise, resolve, reject } = Promise.withResolvers<LorelineResult>();
    const timer = setTimeout(() => {
      this.fail(new Error("Loreline execution exceeded 2 seconds; story stopped"));
      void this.close();
    }, 2_000);
    this.pending.set(id, { resolve, reject, timer });
    this.worker.postMessage({ id, action, index, choiceId });
    return promise;
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fail(this.failure ?? new Error("Loreline runtime closed"));
    this.closing = this.exited ? Promise.resolve() : this.worker.terminate().then(() => {});
    return this.closing;
  }
}
