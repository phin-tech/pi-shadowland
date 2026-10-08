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
  if (!Array.isArray(value) || value.length !== 2) throw new Error("A cast must contain exactly two characters");
  const characters = value.map((value, index) => {
    const character = object(value, `characters[${index}]`);
    return { name: text(character.name, `characters[${index}].name`, 64), persona: text(character.persona, `characters[${index}].persona`, 1200) };
  });
  if (characters[0].name === characters[1].name) throw new Error("Character names must be distinct");
  return characters;
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
  const scenes = pack.scenes.map((value, index): Scene => {
    const label = `scenes[${index}]`;
    const scene = object(value, label);
    const sceneId = text(scene.id, `${label}.id`, 128);
    if (ids.has(sceneId)) throw new Error(`Duplicate scene id: ${sceneId}`);
    ids.add(sceneId);
    if (!Array.isArray(scene.lines) || scene.lines.length < 2 || scene.lines.length > 4) {
      throw new Error(`${label}.lines must contain 2–4 dialogue lines`);
    }
    const lines = scene.lines.map((value, lineIndex) => {
      const line = object(value, `${label}.lines[${lineIndex}]`);
      const speaker = text(line.speaker, `${label}.speaker`, 64);
      if (!characters.some(character => character.name === speaker)) throw new Error(`${label}: speaker must belong to the pack's cast`);
      return { speaker, text: text(line.text, `${label}.lines[${lineIndex}].text`, 240) };
    });
    if (new Set(lines.map(line => line.speaker)).size !== 2) throw new Error(`${label} must include both characters`);
    return {
      id: sceneId, title: text(scene.title, `${label}.title`, 160),
      episode: integer(scene.episode, `${label}.episode`), beat: integer(scene.beat, `${label}.beat`),
      canon: text(scene.canon, `${label}.canon`, 1200), characters, lines,
    };
  });
  return { version: 1, id, title: text(pack.title, "pack.title", 160), description: text(pack.description, "pack.description", 1200), characters, scenes };
}

/** Accept a local JSON file or public HTTP(S) JSON, including GitHub raw URLs. */
export async function loadPack(source: string, signal?: AbortSignal): Promise<StoryPack> {
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
  return parsePack(JSON.parse(data));
}
