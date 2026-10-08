import { readFile, stat } from "node:fs/promises";
import type { Scene, Character } from "./story.js";

export interface StoryPack {
  version: 1;
  id: string;
  title: string;
  description: string;
  characters: Character[];
  scenes: Scene[];
}

const MAX_BYTES = 1_048_576;
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || CONTROL.test(value)) {
    throw new Error(`${label} must be nonempty text, at most ${max} characters, without control characters`);
  }
  return value;
}
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer`);
  return value as number;
}

export function parseCast(value: unknown): Character[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("A cast must contain at least two characters");
  const characters = value.map((value, index) => {
    const character = object(value, `characters[${index}]`);
    return { name: text(character.name, `characters[${index}].name`, 64), persona: text(character.persona, `characters[${index}].persona`, 1200) };
  });
  if (new Set(characters.map(character => character.name)).size !== characters.length) throw new Error("Character names must be distinct");
  return characters;
}

/** Validate rendered scenes, including Loreline's narration and pending choices. */
export function parseScene(value: unknown, characters: Character[]): Scene {
  const scene = object(value, "scene");
  const choices = scene.choices === undefined ? undefined : (() => {
    if (!Array.isArray(scene.choices) || scene.choices.length < 1 || scene.choices.length > 16) throw new Error("A choice must contain 1–16 options");
    return scene.choices.map(value => {
      const option = object(value, "choice");
      if (typeof option.enabled !== "boolean") throw new Error("choice.enabled must be boolean");
      return { text: text(option.text, "choice.text", 240), enabled: option.enabled };
    });
  })();
  if (!Array.isArray(scene.lines) || scene.lines.length > 4 || (scene.lines.length < 1 && !choices)) throw new Error("A scene needs 1–4 lines or a pending choice");
  const lines = scene.lines.map(value => {
    const line = object(value, "line");
    const speaker = text(line.speaker, "line.speaker", 64);
    if (!characters.some(character => character.name === speaker)) throw new Error("Speaker must belong to the story's cast");
    return { speaker, text: text(line.text, "line.text", 240) };
  });
  return {
    id: text(scene.id, "scene.id", 128), title: text(scene.title, "scene.title", 160),
    episode: integer(scene.episode, "scene.episode"), beat: integer(scene.beat, "scene.beat"),
    canon: text(scene.canon, "scene.canon", 1200), characters, lines,
    ...(choices ? { choices, choiceId: text(scene.choiceId, "scene.choiceId", 160) } : {}),
  };
}

/** Validate public content before it reaches terminal rendering or session storage. */
export function parsePack(value: unknown): StoryPack {
  const pack = object(value, "pack");
  if (pack.version !== 1) throw new Error("Unsupported story pack version (expected 1)");
  const id = text(pack.id, "pack.id", 64);
  if (!ID.test(id)) throw new Error("pack.id must use letters, digits, dots, underscores, or hyphens");
  const characters = parseCast(pack.characters);
  if (!Array.isArray(pack.scenes) || pack.scenes.length < 1 || pack.scenes.length > 100) {
    throw new Error("pack.scenes must contain 1–100 scenes");
  }
  const ids = new Set<string>();
  const scenes = pack.scenes.map((value): Scene => {
    const scene = parseScene(value, characters);
    if (ids.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    if (scene.choices) throw new Error("Interactive choices require a Loreline story, not a JSON pack");
    if (scene.lines.length < 2) throw new Error("Pack scenes must contain 2–4 dialogue lines");
    if (new Set(scene.lines.map(line => line.speaker)).size < 2) throw new Error("Pack scenes must include at least two characters");
    return scene;
  });
  return { version: 1, id, title: text(pack.title, "pack.title", 160), description: text(pack.description, "pack.description", 1200), characters, scenes };
}

/** Read bounded local or public HTTP(S) story content without resolving imports. */
export async function loadSource(source: string, signal?: AbortSignal): Promise<string> {
  let data: string;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Story pack request failed: HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Story pack response has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Story pack exceeds 1 MiB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    data = Buffer.concat(chunks).toString("utf8");
  } else {
    if ((await stat(source)).size > MAX_BYTES) throw new Error("Story pack exceeds 1 MiB");
    data = await readFile(source, "utf8");
    if (Buffer.byteLength(data) > MAX_BYTES) throw new Error("Story pack exceeds 1 MiB");
  }
  return data;
}

export async function loadPack(source: string, signal?: AbortSignal): Promise<StoryPack> {
  return parsePack(JSON.parse(await loadSource(source, signal)));
}
