import { formatScene } from "./story.js";
import { loadPack } from "./packs.js";
import { Playback, fingerprint, type SavedPlayback } from "./playback.js";

export interface DisplayMessage {
  role: string;
  timestamp: number;
  content: Array<{ type: string; thinking?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
interface Context {
  hasUI: boolean;
  mode?: string;
  agent?: { kind: string };
  sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown; message?: DisplayMessage }> };
  ui: { notify(text: string, level?: "info" | "warning" | "error"): void };
}
export interface ExtensionHost {
  on(event: string, handler: (event: { message?: DisplayMessage }, ctx: Context) => void | Promise<void>): void;
  appendEntry(type: string, data: unknown): void;
  registerCommand(name: string, command: { description: string; handler(args: string, ctx: Context): Promise<void> }): void;
  registerMarkdownTransformer?: (transform: (text: string, ctx: { messageType: string; isStreaming: boolean }) => string) => void;
  pi?: { AssistantMessageComponent: { prototype: { updateContent(message: DisplayMessage, ...args: unknown[]): unknown } } };
}
interface Checkpoint { version: 1; playback: SavedPlayback; aliases: Record<string, string> }
const ENTRY = "shadownet-state";

/** Pi uses its public transform hook. OMP's optional entry supplies an explicit internal adapter. */
export function installExtension(host: ExtensionHost, adapter?: (render: (message: DisplayMessage) => DisplayMessage) => () => void): void {
  if (!host.registerMarkdownTransformer && !adapter) {
    throw new Error("This host has no reasoning replacement hook. On OMP use omp.ts for the experimental renderer adapter; index.ts uses Pi's public Markdown transformer.");
  }
  let playback = new Playback();
  let aliases = new Map<string, string>();
  let active = false;
  let live = false;
  let dirty = false;
  let removeAdapter: (() => void) | undefined;
  let loading: AbortController | undefined;
  const originalMessages = new WeakMap<DisplayMessage, DisplayMessage>();

  function capture(message: DisplayMessage): void {
    if (!active || !playback.enabled || message.role !== "assistant") return;
    let run = 0;
    for (let i = 0; i < message.content.length; i++) {
      if (message.content[i].type !== "thinking") continue;
      const texts: string[] = [];
      for (; i < message.content.length && message.content[i].type === "thinking"; i++) {
        const text = message.content[i].thinking?.trim();
        if (text) texts.push(text);
      }
      i--;
      const text = texts.join("\n\n");
      const key = `${message.timestamp}:${run++}`;
      if (!text) continue;
      // The public Pi hook exposes Markdown, not message identity. Identical passages
      // intentionally retain their first exchange, including history redraws.
      const hash = fingerprint(text);
      if (!aliases.has(hash)) aliases.set(hash, key);
      playback.scene(aliases.get(hash)!);
      dirty = true;
    }
  }

  function checkpoint(): void {
    if (!active || !dirty) return;
    host.appendEntry(ENTRY, { version: 1, playback: playback.snapshot(), aliases: Object.fromEntries(aliases) } satisfies Checkpoint);
    dirty = false;
  }

  function renderMessage(input: DisplayMessage): DisplayMessage {
    const message = originalMessages.get(input) ?? input;
    if (!active || !playback.enabled || message.role !== "assistant") return message;
    const content = message.content.map((block, index) => {
      if (block.type !== "thinking" || !block.thinking?.trim()) return block;
      // OMP renders thinking blocks individually, unlike Pi's grouped runs.
      const key = `omp:${message.timestamp}:${index}`;
      return { ...block, thinking: formatScene(playback.scene(key)) };
    });
    const display = { ...message, content };
    originalMessages.set(display, message);
    dirty = true;
    return display;
  }

  if (host.registerMarkdownTransformer) {
    host.registerMarkdownTransformer((text, context) => {
      if (!active || !playback.enabled || context.messageType !== "assistant-thinking" || !text.trim()) return text;
      const hash = fingerprint(text.trim());
      const key = aliases.get(hash) ?? `archive:${hash}`;
      return playback.render(key);
    });
  }

  async function restore(_event: { message?: DisplayMessage }, ctx: Context): Promise<void> {
    loading?.abort();
    removeAdapter?.();
    removeAdapter = undefined;
    live = false;
    active = ctx.hasUI && (ctx.mode === undefined || ctx.mode === "tui") && ctx.agent?.kind !== "sub";
    if (!active) return;
    const branch = ctx.sessionManager.getBranch();
    const saved = branch.filter(entry => entry.type === "custom" && entry.customType === ENTRY).at(-1)?.data as Checkpoint | undefined;
    playback = new Playback(saved?.playback);
    aliases = new Map(Object.entries(saved?.aliases ?? {}));
    dirty = false;
    if (adapter) removeAdapter = adapter(renderMessage);
    if (!saved && process.env.SHADOWNET_PACK) {
      loading = new AbortController();
      try {
        const pack = await loadPack(process.env.SHADOWNET_PACK, loading.signal);
        if (!loading.signal.aborted) { playback.usePack(pack); dirty = true; checkpoint(); }
      } catch (error) {
        if (!loading.signal.aborted) ctx.ui.notify(`Shadownet: pack unavailable; using authored campaign. ${String(error)}`, "warning");
      }
    }
  }

  for (const event of ["session_start", "session_switch", "session_tree", "session_fork", "session_branch"]) host.on(event, restore);
  host.on("agent_start", () => { live = active; });
  for (const event of ["message_start", "message_update", "message_end"]) {
    host.on(event, payload => {
      if (!adapter && live && payload.message) capture(payload.message);
      if (event === "message_end") checkpoint();
    });
  }
  host.on("agent_end", () => { checkpoint(); live = false; });
  host.on("session_shutdown", () => {
    loading?.abort();
    checkpoint();
    removeAdapter?.();
    removeAdapter = undefined;
    active = false;
  });
  host.registerCommand("shadownet", {
    description: "Fictional decker comms: status | on | off | pack <file-or-url>",
    async handler(args, ctx) {
      if (!active) { ctx.ui.notify("Shadownet reasoning replacement requires an interactive terminal.", "warning"); return; }
      const command = args.trim();
      if (command === "on" || command === "off") {
        playback.enabled = command === "on";
        dirty = true;
        checkpoint();
        ctx.ui.notify(`Shadownet ${command}; applies on the next transcript redraw.`, "info");
      } else if (command.startsWith("pack ")) {
        if (live) { ctx.ui.notify("Switch packs after the current agent turn finishes.", "warning"); return; }
        loading?.abort();
        const request = new AbortController();
        loading = request;
        try {
          const pack = await loadPack(command.slice(5).trim(), request.signal);
          if (request.signal.aborted) return;
          playback.usePack(pack);
          dirty = true;
          checkpoint();
          ctx.ui.notify(`Loaded ${pack.title} (${pack.scenes.length} scenes). Starts with the next reasoning block.`, "info");
        } catch (error) { if (!request.signal.aborted) ctx.ui.notify(`Shadownet: ${String(error)}`, "error"); }
      } else if (!command || command === "status") {
        ctx.ui.notify(playback.status(), "info");
      } else ctx.ui.notify("Usage: /shadownet [status|on|off|pack <file-or-url>]", "warning");
    },
  });
}
