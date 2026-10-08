import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createState, nextScene, formatScene, DEFAULT_CAST } from "./story.js";
import { configFromEnv, generatePack, augmentScene } from "./generator.js";
import { loadPack, parsePack, parseCast, type StoryPack } from "./packs.js";

const HELP = `shadownet — generate and publish fictional decker conversations

  bun run src/cli.ts builtin --out stories/ghost-wire.json [--seed 42] [--scenes 27]
  bun run src/cli.ts generate --id ghost-wire --premise "A fixer sells a haunted datachip" --out stories/ghost-wire.json [--scenes 12]
  Optional generation flag: --cast characters.json (two names and persona descriptions)
  bun run src/cli.ts augment <file-or-url> --scene 1 --out stories/remix.json
  bun run src/cli.ts validate <file-or-url>
  bun run src/cli.ts preview <file-or-url>

Generation is opt-in. Set SHADOWNET_MODEL, SHADOWNET_API_KEY (or OPENAI_API_KEY),
and optionally SHADOWNET_BASE_URL (default https://api.openai.com/v1).
Local OpenAI-compatible servers may omit the key. No coding context is sent.
Output files are never overwritten. Commit JSON to GitHub; use its raw URL.
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

async function save(pack: StoryPack, path: string): Promise<void> {
  parsePack(pack);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(pack, null, 2) + "\n", { flag: "wx" });
  console.log(`Wrote ${path}: ${pack.title} (${pack.scenes.length} scenes)`);
}

export async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "help") { console.log(HELP); return; }
  if (command === "preview" || command === "validate") {
    if (rest.length !== 1) throw new Error(`${command} requires one file or URL`);
    const pack = await loadPack(rest[0]);
    console.log(`${pack.title} · ${pack.scenes.length} scenes\n${pack.description}`);
    if (command === "preview") {
      for (const scene of pack.scenes) console.log(`\n[${scene.episode}.${scene.beat}] ${scene.title}\n\n${formatScene(scene)}`);
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
    if (!config) throw new Error("Set SHADOWNET_MODEL to enable generation");
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
    if (!config) throw new Error("Set SHADOWNET_MODEL to enable generation");
    if (!opts.id || !opts.premise) throw new Error("generate requires --id and --premise");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(opts.id)) throw new Error("Invalid --id (1–64 letters, digits, dots, underscores, hyphens)");
    const characters = opts.cast ? parseCast(JSON.parse(await readFile(opts.cast, "utf8"))) : DEFAULT_CAST;
    const pack = await generatePack(config, { id: opts.id, premise: opts.premise, scenes: count(opts.scenes, 12, 6, 24), characters });
    await save(pack, opts.out);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`shadownet: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
