import { formatScene, formatScenePlain } from "./story.js";
import { StoryPanel } from "./overlay.js";
import { loadStory } from "./loreline.js";
import { Playback, fingerprint } from "./playback.js";
import type { SavedPlayback } from "./playback.js";
import { startStoryWindow, openStoryWindow } from "./window.js";
import type { StoryWindow } from "./window.js";
import type { Scene } from "./story.js";

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
  ui: {
    notify(text: string, level?: "info" | "warning" | "error"): void;
    custom?(factory: (tui: { requestRender(): void }, theme: unknown, keybindings: unknown, done: (result: undefined) => void) => unknown, options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> }): Promise<unknown>;
  };
}
export interface ExtensionHost {
  on(event: string, handler: (event: { message?: DisplayMessage; text?: string; source?: string }, ctx: Context) => void | InputResult | Promise<void | InputResult>): void;
  appendEntry(type: string, data: unknown): void;
  registerCommand(name: string, command: { description: string; handler(args: string, ctx: Context): Promise<void> }): void;
  registerMarkdownTransformer?: (transform: (text: string, ctx: { messageType: string; isStreaming: boolean }) => string) => void;
  pi?: { AssistantMessageComponent: { prototype: { updateContent(message: DisplayMessage, ...args: unknown[]): unknown } } };
}
/** Pi reads `action`, OMP reads `handled`; returning both swallows input on either host. */
type InputResult = { action: "handled"; handled: true };
const SWALLOWED: InputResult = { action: "handled", handled: true };
const ALIAS = "sl";
type DisplayMode = "terminal" | "window" | "both";
interface Checkpoint { version: 1; playback: SavedPlayback; aliases: Record<string, string>; display?: DisplayMode }
const ENTRY = "shadowland-state";

/** Pi uses its public transform hook. OMP's optional entry supplies an explicit internal adapter. */
export function installExtension(host: ExtensionHost, adapter?: (render: (message: DisplayMessage) => DisplayMessage) => () => void): void {
  const requestedDisplay = process.env.SHADOWLAND_DISPLAY;
  if (requestedDisplay && requestedDisplay !== "terminal" && requestedDisplay !== "window" && requestedDisplay !== "both") throw new Error("SHADOWLAND_DISPLAY must be terminal, window, or both");
  let display = (requestedDisplay ?? "terminal") as DisplayMode;
  if (!host.registerMarkdownTransformer && !adapter && display !== "window") {
    throw new Error("This host has no reasoning replacement hook. On OMP use omp.ts for the experimental renderer adapter; index.ts uses Pi's public Markdown transformer.");
  }
  let playback = new Playback();
  let aliases = new Map<string, string>();
  let active = false;
  let live = false;
  let dirty = false;
  let removeAdapter: (() => void) | undefined;
  let loading: AbortController | undefined;
  let companion: StoryWindow | undefined;
  let storyMode = false;
  let panel: { render(): void; close(): void; focus(): void } | undefined;
  let windowScene: Scene | undefined;

  function refresh(): void {
    companion?.publish();
    panel?.render();
  }

  function closePanel(): void {
    const open = panel;
    panel = undefined;
    open?.close();
  }

  function openPanel(ctx: Context): void {
    if (panel) return;
    if (!ctx.ui.custom) throw new Error("This host has no overlay support");
    let requestRender = () => {};
    let done = () => {};
    let handle: { hide(): void; focus?(): void; unfocus?(): void; isFocused?(): boolean } | undefined;
    const component = new StoryPanel({
      scene: () => playback.view().scene,
      title: () => `SHADOWLAND · ${playback.view().title}`,
      choose: number => { void choose(number, ctx); },
      advance: () => { void advance(ctx); },
      close: () => closePanel(),
      focused: () => handle?.isFocused?.() ?? false,
      // Hosts whose overlay always holds focus (OMP) cannot release it, so Esc closes there.
      release: () => { if (handle?.unfocus) { handle.unfocus(); requestRender(); } else closePanel(); },
    });
    panel = {
      render: () => requestRender(),
      close: () => { try { handle?.hide(); } catch {} done(); },
      focus: () => { if (!handle?.focus) throw new Error("This host's overlay cannot take focus on request"); handle.focus(); requestRender(); },
    };
    ctx.ui.custom((tui, _theme, _keys, finish) => {
      requestRender = () => tui.requestRender();
      done = () => finish(undefined);
      return component;
    }, {
      overlay: true,
      overlayOptions: { anchor: "top-right", width: "45%", minWidth: 42, maxHeight: "70%", margin: 1, nonCapturing: true },
      onHandle: (value: NonNullable<typeof handle>) => { handle = value; },
    } as never).catch(error => { panel = undefined; ctx.ui.notify(`Shadowland overlay stopped: ${String(error)}`, "error"); });
  }

  async function setDisplay(mode: DisplayMode, ctx: Context, launch = true): Promise<void> {
    if (mode !== "window" && !host.registerMarkdownTransformer && !adapter) throw new Error("This entry supports window mode only; use omp.ts for OMP terminal replacement");
    if (mode !== "terminal" && !companion) {
      companion = await startStoryWindow({
        view: () => ({ ...playback.view(), agentActive: live }),
        choose: async (index, choiceId) => { await playback.choose(index, choiceId); dirty = true; checkpoint(); },
        advance: async (sceneId, generation) => { await playback.advance(sceneId, generation); dirty = true; checkpoint(); },
      });
    }
    if (mode === "window") { removeAdapter?.(); removeAdapter = undefined; }
    else if (adapter && !removeAdapter) removeAdapter = adapter(renderMessage);
    display = mode;
    if (mode === "terminal") { await companion?.close(); companion = undefined; }
    else if (companion) {
      companion.publish();
      ctx.ui.notify(`Shadowland window: ${companion.url}\nUse Pop out for a separate window.`, "info");
      if (launch) {
        try { await openStoryWindow(companion.url); }
        catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}\n${companion.url}`, "warning"); }
      }
    }
  }
  const originalMessages = new WeakMap<DisplayMessage, DisplayMessage>();

  function capture(message: DisplayMessage): void {
    if (!active || !playback.enabled || message.role !== "assistant") return;
    if (!host.registerMarkdownTransformer) {
      for (const [index, block] of message.content.entries()) {
        if (block.type !== "thinking" || !block.thinking?.trim()) continue;
        const scene = playback.scene(`omp:${message.timestamp}:${index}`);
        if (scene !== windowScene) { windowScene = scene; refresh(); }
        dirty = true;
      }
      return;
    }
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
      const scene = playback.scene(aliases.get(hash)!);
      if (scene !== windowScene) { windowScene = scene; refresh(); }
      dirty = true;
    }
  }

  function checkpoint(): void {
    if (!active || !dirty) return;
    host.appendEntry(ENTRY, { version: 1, playback: playback.snapshot(), aliases: Object.fromEntries(aliases), display } satisfies Checkpoint);
    dirty = false;
  }

  function renderMessage(input: DisplayMessage): DisplayMessage {
    const message = originalMessages.get(input) ?? input;
    if (!active || !playback.enabled || display === "window" || message.role !== "assistant") return message;
    const content = message.content.map((block, index) => {
      if (block.type !== "thinking" || !block.thinking?.trim()) return block;
      // OMP renders thinking blocks individually, unlike Pi's grouped runs.
      const key = `omp:${message.timestamp}:${index}`;
      const scene = playback.scene(key);
      if (scene !== windowScene) { windowScene = scene; refresh(); }
      return { ...block, thinking: formatScene(scene) };
    });
    const rendered = { ...message, content };
    originalMessages.set(rendered, message);
    dirty = true;
    return rendered;
  }

  if (host.registerMarkdownTransformer) {
    host.registerMarkdownTransformer((text, context) => {
      if (!active || !playback.enabled || display === "window" || context.messageType !== "assistant-thinking" || !text.trim()) return text;
      const hash = fingerprint(text.trim());
      const key = aliases.get(hash) ?? `archive:${hash}`;
      return playback.render(key);
    });
  }

  async function restore(_event: { message?: DisplayMessage }, ctx: Context): Promise<void> {
    active = false;
    storyMode = false;
    closePanel();
    await companion?.close();
    companion = undefined;
    windowScene = undefined;
    await playback.close();
    loading?.abort();
    removeAdapter?.();
    removeAdapter = undefined;
    live = false;
    active = ctx.hasUI && (ctx.mode === undefined || ctx.mode === "tui") && ctx.agent?.kind !== "sub";
    if (!active) return;
    const branch = ctx.sessionManager.getBranch();
    const saved = branch.filter(entry => entry.type === "custom" && entry.customType === ENTRY).at(-1)?.data as Checkpoint | undefined;
    display = (requestedDisplay as DisplayMode | undefined) ?? saved?.display ?? "terminal";
    playback = new Playback(saved?.playback);
    await playback.initialize();
    playback.onChange = error => {
      if (!active) return;
      dirty = true;
      checkpoint();
      refresh();
      if (error) ctx.ui.notify(`Shadowland story stopped: ${error}`, "error");
    };
    aliases = new Map(Object.entries(saved?.aliases ?? {}));
    dirty = false;
    // Window-only mode deliberately never installs the OMP renderer wrapper.
    if (!saved && process.env.SHADOWLAND_PACK) {
      loading = new AbortController();
      try {
        const source = await loadStory(process.env.SHADOWLAND_PACK, loading.signal);
        if (!loading.signal.aborted) { await playback.useStory(source); dirty = true; checkpoint(); }
      } catch (error) {
        if (!loading.signal.aborted) ctx.ui.notify(`Shadowland: pack unavailable; using authored campaign. ${String(error)}`, "warning");
      }
    }
    await setDisplay(display, ctx);
  }

  for (const event of ["session_start", "session_switch", "session_tree", "session_fork", "session_branch"]) host.on(event, restore);
  host.on("agent_start", () => { live = active; refresh(); });
  for (const event of ["message_start", "message_update", "message_end"]) {
    host.on(event, payload => {
      if ((!adapter || display !== "terminal") && live && payload.message) capture(payload.message);
      if (event === "message_end") checkpoint();
    });
  }
  host.on("agent_end", () => { checkpoint(); live = false; refresh(); });
  host.on("session_shutdown", async () => {
    loading?.abort();
    closePanel();
    await playback.close();
    await companion?.close();
    companion = undefined;
    checkpoint();
    removeAdapter?.();
    removeAdapter = undefined;
    active = false;
  });
  async function show(ctx: Context, prefix: string): Promise<void> {
    if (panel) return;
    ctx.ui.notify(`\u001b[97m${prefix}\u001b[39m\n\n${formatScenePlain(playback.view().scene, true)}`, "info");
  }

  async function choose(number: number, ctx: Context): Promise<void> {
    try {
      const selected = await playback.choose(number);
      dirty = true;
      checkpoint();
      refresh();
      await show(ctx, `Shadowland: chose "${selected}".`);
    } catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); }
  }

  async function advance(ctx: Context): Promise<void> {
    try {
      await playback.advance();
      dirty = true;
      checkpoint();
      refresh();
      await show(ctx, "Shadowland:");
    } catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); }
  }

  // Story mode swallows typed input so numbers and Enter drive the story instead of the agent.
  // Slash commands always pass through, so /shadowland exit works even if something goes wrong.
  host.on("input", async (event, ctx) => {
    if (!storyMode || !active || event.source === "extension") return;
    const text = (event.text ?? "").trim();
    if (text.startsWith("/")) return;
    const word = text.toLowerCase();
    if (/^[1-9]\d*$/.test(word)) await choose(Number(word), ctx);
    else if (word === "" || word === "c" || word === "continue" || word === "next") await advance(ctx);
    else if (word === "x" && panel) closePanel();
    else if (word === "exit" || word === "quit" || word === "q") { storyMode = false; ctx.ui.notify("Shadowland: story mode off. Input goes to your agent again.", "info"); }
    else ctx.ui.notify("Shadowland story mode: type a choice number, c to continue, or exit. (Slash commands still work.)", "info");
    return SWALLOWED;
  });

  const command = {
    description: "Story dialogue: enter | exit | overlay | focus | status | on | off | pack <file-or-url> | choose <number> | window | both | terminal",
    async handler(args: string, ctx: Context) {
      if (!active) { ctx.ui.notify("Shadowland reasoning replacement requires an interactive terminal.", "warning"); return; }
      const command = args.trim();
      if (command === "enter" || command === "play") {
        storyMode = true;
        await show(ctx, "Shadowland story mode: your input now drives the story, not the agent. Type a choice number, c (or Enter) to continue, exit to leave.");
      } else if (command === "overlay" || command === "overlay on" || command === "overlay off") {
        if (command === "overlay off" || (command === "overlay" && panel)) closePanel();
        else { try { openPanel(ctx); } catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); } }
      } else if (command === "focus") {
        try {
          if (!panel) openPanel(ctx);
          panel?.focus();
        } catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); }
      } else if (command === "exit" || command === "leave") {
        storyMode = false;
        ctx.ui.notify("Shadowland: story mode off. Input goes to your agent again.", "info");
      } else if (command === "continue" || command === "next") {
        await advance(ctx);
      } else if (command === "on" || command === "off") {
        playback.enabled = command === "on";
        dirty = true;
        checkpoint();
        refresh();
        ctx.ui.notify(`Shadowland ${command}; applies on the next transcript redraw.`, "info");
      } else if (command === "window" || command === "both" || command === "terminal") {
        try { await setDisplay(command, ctx); dirty = true; checkpoint(); }
        catch (error) { ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); }
      } else if (/^choose [1-9]\d*$/.test(command)) {
        await choose(Number(command.slice(7)), ctx);
      } else if (command.startsWith("pack ")) {
        if (live) { ctx.ui.notify("Switch packs after the current agent turn finishes.", "warning"); return; }
        loading?.abort();
        const request = new AbortController();
        loading = request;
        try {
          const source = await loadStory(command.slice(5).trim(), request.signal);
          if (request.signal.aborted) return;
          await playback.useStory(source);
          dirty = true;
          checkpoint();
          refresh();
          ctx.ui.notify(`Loaded ${source.title}${"scenes" in source ? ` (${source.scenes.length} scenes)` : " (interactive Loreline)"}. Starts with the next reasoning block.\n${playback.status()}`, "info");
        } catch (error) { if (!request.signal.aborted) ctx.ui.notify(`Shadowland: ${String(error)}`, "error"); }
      } else if (!command || command === "status") {
        ctx.ui.notify(playback.status(), "info");
      } else ctx.ui.notify(`Usage: /shadowland [enter|exit|overlay|focus|continue|status|on|off|pack <file-or-url>|choose <number>|window|both|terminal] (alias: /${ALIAS})`, "warning");
    },
  };
  host.registerCommand("shadowland", command);
  host.registerCommand(ALIAS, { ...command, description: `Alias for /shadowland. ${command.description}` });
}
