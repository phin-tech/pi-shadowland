import { DEFAULT_CAST } from "./story.js";
import { parsePack, parseCast } from "./packs.js";
import type { Scene, Character } from "./story.js";
import type { StoryPack } from "./packs.js";
import { LorelineRuntime, parseLorelineStory } from "./loreline.js";
import type { LorelineStory } from "./loreline.js";

export interface GeneratorConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

const TIMEOUT_MS = 15_000;
const MAX_LINE_LENGTH = 240;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const PERSONAS = `Write original fictional dialogue among characters in the supplied cast.
Follow each character's persona and the supplied setting, premise, and relationship. Their distinct voices carry the story.
Recognizable book characters are permitted, but invent new dialogue: never reproduce book passages, quotations, or lyrics.
Never discuss coding tasks, AI assistants, or hidden reasoning.
Each exchange contains 2–4 short lines, includes at least two cast members, and uses their exact names as speakers. Rotate smaller groups through an ensemble; not everyone needs to speak in every scene.
Each text is a single plain-text line of at most 240 characters, with no control characters, terminal escapes, or invisible formatting characters.
Return only the requested JSON object, without Markdown fences or commentary.`;

/** No provider is enabled unless SHADOWLAND_MODEL is explicitly configured. */
export function configFromEnv(
  env: Record<string, string | undefined>,
): GeneratorConfig | undefined {
  const model = env.SHADOWLAND_MODEL?.trim();
  if (!model) return undefined;

  const apiKey = env.SHADOWLAND_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  return {
    baseUrl: env.SHADOWLAND_BASE_URL?.trim() || "https://api.openai.com/v1",
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Rephrases one authored beat; no host conversation or reasoning is accepted. */
export async function augmentScene(
  scene: Scene,
  config: GeneratorConfig,
  signal?: AbortSignal,
): Promise<Scene> {
  const characters = parseCast(scene.characters);
  const result = await requestJson(
    config,
    `${PERSONAS}
Rephrase the supplied authored exchange without changing its meaning or established canon.
The supplied beat is the entire scope. Do not invent characters, objects, objectives, discoveries, outcomes, or future/cliffhanger facts outside it.
Flavor, slang, and metaphors may change; facts may not. Preserve the beat's narrative purpose.
Return {"lines":[{"speaker":"exact character name","text":"..."}]}.`,
    {
      id: scene.id,
      title: scene.title,
      episode: scene.episode,
      beat: scene.beat,
      canon: scene.canon,
      characters,
      authoredLines: scene.lines.map(({ speaker, text }) => ({ speaker, text })),
    },
    400,
    signal,
  );

  const object = requireObject(result, "Scene response");
  return { ...scene, lines: validateLines(object.lines, "Scene response", characters) };
}

/** Creates a self-contained pack independently of any host coding session. */
export async function generatePack(
  config: GeneratorConfig,
  options: { id: string; premise: string; scenes: number; characters?: Character[] },
  signal?: AbortSignal,
): Promise<StoryPack> {
  if (!Number.isInteger(options.scenes) || options.scenes < 6 || options.scenes > 24) {
    throw new Error("Story generation requires an integer scene count from 6 to 24.");
  }
  if (typeof options.id !== "string" || !options.id.trim()) {
    throw new Error("Story generation requires a nonempty pack id.");
  }
  if (typeof options.premise !== "string" || !options.premise.trim()) {
    throw new Error("Story generation requires a nonempty fictional premise.");
  }
  const characters = parseCast(options.characters ?? DEFAULT_CAST);

  const result = await requestJson(
    config,
    `${PERSONAS}
Generate a complete, original, ordered story pack from the supplied fictional premise.
Return exactly the requested number of scenes. Develop the ensemble across the story, allowing different groups to speak in different scenes.
Establish recurring plot threads, escalate them across successive beats, and pay them off by the final scene.
Every scene must advance the story rather than reset it. Keep continuity of knowledge, injuries, relationships, and consequences.
The final scene resolves the main arc; do not end with an unresolved cliffhanger.
Give the pack a short title and description. Each scene has a short title, a concise canon summary of that beat, and its dialogue lines.
The canon summary must capture all new facts in that beat, and its dialogue must not introduce facts outside the established story and that summary.
Return {"title":"...","description":"...","scenes":[{"title":"...","canon":"...","lines":[{"speaker":"exact character name","text":"..."}]}]}.`,
    { id: options.id, premise: options.premise, scenes: options.scenes, characters },
    512 + options.scenes * 360,
    signal,
  );

  const object = requireObject(result, "Story pack response");
  if (!Array.isArray(object.scenes) || object.scenes.length !== options.scenes) {
    throw new Error(`Story pack response must contain exactly ${options.scenes} scenes.`);
  }

  const scenes = object.scenes.map((value, index) => {
    const scene = requireObject(value, `Scene ${index + 1}`);
    return {
      id: `${options.id}-${index + 1}`,
      title: scene.title,
      episode: 1,
      beat: index + 1,
      canon: scene.canon,
      lines: validateLines(scene.lines, `Scene ${index + 1}`, characters),
    };
  });

  return parsePack({
    version: 1,
    id: options.id,
    title: object.title,
    description: object.description,
    characters,
    scenes,
  });
}

/** Generates executable story source, validated by the same isolated runtime as playback. */
export async function generateLoreline(
  config: GeneratorConfig,
  options: { id: string; premise: string; scenes: number; characters?: Character[] },
  signal?: AbortSignal,
): Promise<LorelineStory> {
  if (!Number.isInteger(options.scenes) || options.scenes < 6 || options.scenes > 24 || !options.premise.trim()) throw new Error("Loreline generation needs a premise and 6–24 beats");
  const characters = parseCast(options.characters ?? DEFAULT_CAST);
  const response = requireObject(await requestJson(config, `Write original interactive fiction as a self-contained Loreline (.lor) script.
Follow the supplied cast and premise; invent dialogue, never quote books or lyrics. Never discuss coding, assistants, or hidden reasoning.
Declare each character with a safe identifier (not reserved words such as null), name and persona fields. Quote field strings containing punctuation such as commas.
Use state variables, branching choices, conditional dialogue, and recurring subplots with consequences. Each beat has 2–4 short dialogue lines (maximum 240 characters each).
Use -> BeatName transitions and -> . to end every story route. All destinations must exist. Include approximately the requested number of beats.
Function scripting is permitted for pure story calculations. No imports, external functions, filesystem access, or host integrations.
Return only {"title":"...","description":"...","source":"complete .lor source"} as JSON, without Markdown fences.`, { ...options, characters }, 800 + options.scenes * 450, signal), "Loreline response");
  const story = parseLorelineStory({ format: "loreline", version: 1, id: options.id, title: response.title, description: response.description, source: response.source });
  const runtime = new LorelineRuntime(story);
  try { await runtime.next(); } finally { await runtime.close(); }
  return story;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function validateLines(value: unknown, label: string, characters: Character[]): Scene["lines"] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new Error(`${label} must contain 2–4 dialogue lines.`);
  }
  const speakers = new Set<string>();
  const lines = value.map((item, index): Scene["lines"][number] => {
    const line = requireObject(item, `${label} line ${index + 1}`);
    if (typeof line.speaker !== "string" || !characters.some(character => character.name === line.speaker)) {
      throw new Error(`${label} line ${index + 1} has a speaker outside the configured cast.`);
    }
    if (
      typeof line.text !== "string" ||
      !line.text.trim() ||
      line.text.length > MAX_LINE_LENGTH ||
      UNSAFE_TEXT.test(line.text)
    ) {
      throw new Error(
        `${label} line ${index + 1} must be nonempty, at most ${MAX_LINE_LENGTH} characters, and free of control or formatting characters.`,
      );
    }
    speakers.add(line.speaker);
    return { speaker: line.speaker, text: line.text };
  });
  if (speakers.size < 2) {
    throw new Error(`${label} must include at least two configured characters.`);
  }
  return lines;
}

async function requestJson(
  config: GeneratorConfig,
  instructions: string,
  input: object,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!config.model.trim()) throw new Error("The generation model must not be empty.");

  let endpoint: URL;
  try {
    endpoint = new URL(config.baseUrl);
  } catch {
    throw new Error("The generation base URL must be an absolute HTTP or HTTPS URL.");
  }
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("The generation base URL must use HTTP or HTTPS without a query or fragment.");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/chat/completions`;

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("Shadowland generation timed out after 15 seconds.")),
    TIMEOUT_MS,
  );

  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(input) },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
        response_format: { type: "json_object" },
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Shadowland provider returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Shadowland provider returned an invalid JSON response.");
    }
    const object = requireObject(payload, "Provider response");
    if (!Array.isArray(object.choices) || object.choices.length === 0) {
      throw new Error("Shadowland provider response is missing its completion choices.");
    }
    const choice = requireObject(object.choices[0], "Provider completion");
    if (choice.finish_reason === "length") {
      throw new Error("Shadowland provider truncated the generated JSON at its token limit.");
    }
    const message = requireObject(choice.message, "Provider completion message");
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new Error("Shadowland provider completion must contain a nonempty JSON string.");
    }
    try {
      return JSON.parse(message.content) as unknown;
    } catch {
      throw new Error("Shadowland provider completion is not valid JSON; Markdown fences are not accepted.");
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
