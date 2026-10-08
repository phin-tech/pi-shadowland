import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { createState, nextScene, formatScenePlain as formatScene, DEFAULT_CAST } from "./story.js";
import { configFromEnv, generatePack, generateLoreline, augmentScene } from "./generator.js";
import { loadPack, parsePack, parseCast } from "./packs.js";
import { loadStory, LorelineRuntime, parseLorelineStory } from "./loreline.js";
import type { StorySource } from "./loreline.js";

const HELP = `shadowland — generate and publish themed character conversations

  bun run src/cli.ts builtin --out stories/ghost-wire.json [--seed 42] [--scenes 27]
  bun run src/cli.ts generate --id ghost-wire --premise "A fixer sells a haunted datachip" --out stories/ghost-wire.json [--scenes 12]
  Optional generation flag: --cast characters.json (two or more names and personas)
  Use --out stories/my-story.lor to generate an interactive Loreline story instead of JSON.
  bun run src/cli.ts augment <file-or-url> --scene 1 --out stories/remix.json
  bun run src/cli.ts validate <file-or-url>
  bun run src/cli.ts preview <file-or-url>

Generation is opt-in. Set SHADOWLAND_MODEL, SHADOWLAND_API_KEY (or OPENAI_API_KEY),
and optionally SHADOWLAND_BASE_URL (default https://api.openai.com/v1).
Local OpenAI-compatible servers may omit the key. No coding context is sent.
Output files are never overwritten. Commit JSON or .lor to GitHub; use its raw URL.
`;

function options(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const allowed: Record<string, true> = { out: true, seed: true, scenes: true, scene: true, id: true, premise: true, cast: true };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, "");
    const value = args[i + 1];
    if (!args[i]?.startsWith("--") || !allowed[name] || value === undefined || value.startsWith("--")) throw new Error(`Invalid option: ${args[i]}`);
    if (result[name] !== undefined) throw new Error(`Duplicate option: --${name}`);
    result[name] = value;
  }
  return result;
}
function count(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Expected integer between ${min} and ${max}`);
  return n;
}

async function save(source: StorySource, path: string): Promise<void> {
  const loreline = "format" in source;
  const content = loreline ? parseLorelineStory(source).source : JSON.stringify(parsePack(source), null, 2);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content + "\n", { flag: "wx" });
  console.log(`Wrote ${path}: ${source.title}${loreline ? " (interactive Loreline)" : ` (${source.scenes.length} scenes)`}`);
}

export async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "help") { console.log(HELP); return; }
  if (command === "preview" || command === "validate") {
    if (rest.length !== 1) throw new Error(`${command} requires one file or URL`);
    const source = await loadStory(rest[0]);
    if ("format" in source) {
      const runtime = new LorelineRuntime(source);
      const input = command === "preview" && process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
      try {
        let result = await runtime.next();
        console.log(`${source.title} · interactive Loreline\n${source.description}`);
        if (command === "validate") { console.log("Parsed and executed through the first dialogue/choice boundary."); return; }
        for (;;) {
          console.log(`\n${formatScene(result.scene)}`);
          if (result.checkpoint.finished) break;
          if (result.scene.choices) {
            if (!input) { console.log("\nRun preview in an interactive terminal to select a branch."); break; }
            const answer = await input.question("Choose a number (q to quit): ");
            if (answer.trim() === "q") break;
            const index = Number(answer);
            if (!Number.isSafeInteger(index) || !result.scene.choices[index - 1]?.enabled) { console.log("Choose an enabled option."); continue; }
            result = await runtime.choose(index - 1);
          } else result = await runtime.next();
        }
      } finally { input?.close(); await runtime.close(); }
      return;
    }
    console.log(`${source.title} · ${source.scenes.length} scenes\n${source.description}`);
    if (command === "preview") {
      for (const scene of source.scenes) console.log(`\n[${scene.episode}.${scene.beat}] ${scene.title}\n\n${formatScene(scene)}`);
    }
    return;
  }
  if (command === "augment") {
    const [source, ...flags] = rest;
    if (!source) throw new Error("augment requires a file or URL");
    const opts = options(flags);
    if (!opts.out) throw new Error("--out is required");
    try { await stat(opts.out); throw new Error(`Output already exists: ${opts.out}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const config = configFromEnv(process.env);
    if (!config) throw new Error("Set SHADOWLAND_MODEL to enable generation");
    const pack = await loadPack(source);
    const index = count(opts.scene, 1, 1, pack.scenes.length) - 1;
    pack.scenes[index] = await augmentScene(pack.scenes[index], config);
    await save(pack, opts.out);
    return;
  }
  if (command !== "builtin" && command !== "generate") throw new Error(`Unknown command: ${command}`);
  const opts = options(rest);
  if (!opts.out) throw new Error("--out is required");
  // Refuse an existing destination before paying for generation.
  try { await stat(opts.out); throw new Error(`Output already exists: ${opts.out}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (command === "builtin") {
    let state = createState(count(opts.seed, 42, 0, 0xffff_ffff));
    const scenes = [];
    for (let i = 0; i < count(opts.scenes, 27, 1, 100); i++) {
      const next = nextScene(state);
      scenes.push(next.scene);
      state = next.state;
    }
    await save({ version: 1, id: opts.id ?? "ghost-wire", title: "Ghost Wire", description: "NULL and HEX juggle stolen corporate evidence, a clinic's debt, and a captive Matrix courier.", characters: DEFAULT_CAST, scenes }, opts.out);
  } else {
    const config = configFromEnv(process.env);
    if (!config) throw new Error("Set SHADOWLAND_MODEL to enable generation");
    if (!opts.id || !opts.premise) throw new Error("generate requires --id and --premise");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(opts.id)) throw new Error("Invalid --id (1–64 letters, digits, dots, underscores, hyphens)");
    const characters = opts.cast ? parseCast(JSON.parse(await readFile(opts.cast, "utf8"))) : DEFAULT_CAST;
    const input = { id: opts.id, premise: opts.premise, scenes: count(opts.scenes, 12, 6, 24), characters };
    const story = /\.lor(?:\.txt)?$/i.test(opts.out) ? await generateLoreline(config, input) : await generatePack(config, input);
    await save(story, opts.out);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`shadowland: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
