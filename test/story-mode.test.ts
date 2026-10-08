import { test, expect } from "bun:test";
import { installExtension } from "../src/extension.js";
import type { ExtensionHost } from "../src/extension.js";

type Handler = (event: any, ctx: any) => unknown;

function harness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler(args: string, ctx: any): Promise<void> }>();
  const notes: string[] = [];
  const overlay: { component?: any; renders: number; closed: boolean; options?: any } = { renders: 0, closed: false };
  const ctx = {
    hasUI: true, mode: "tui", sessionManager: { getBranch: () => [] },
    ui: {
      notify: (text: string) => notes.push(text),
      custom: (factory: any, options: any) => new Promise(resolve => {
        overlay.options = options;
        overlay.component = factory({ requestRender: () => overlay.renders++ }, {}, {}, () => { overlay.closed = true; resolve(undefined); });
        options.onHandle?.({ hide: () => { overlay.closed = true; } });
      }),
    },
  };
  const host = {
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    appendEntry() {},
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerMarkdownTransformer() {},
  } as unknown as ExtensionHost;
  installExtension(host);
  const emit = async (event: string, payload: object = {}) => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = (await handler(payload, ctx)) ?? result;
    return result;
  };
  return { commands, notes, ctx, emit, overlay };
}

test("/sl aliases /shadowland and story mode swallows input until exit", async () => {
  const { commands, notes, ctx, emit } = harness();
  expect(commands.has("sl")).toBe(true);
  await emit("session_start");
  try {
    await commands.get("sl")!.handler(`pack ${new URL("../stories/ghost-wire.lor", import.meta.url).pathname}`, ctx);
    expect(await emit("input", { text: "hello agent", source: "interactive" })).toBeUndefined();

    await commands.get("sl")!.handler("enter", ctx);
    const swallowed = await emit("input", { text: "c", source: "interactive" });
    expect(swallowed).toEqual({ action: "handled", handled: true });
    expect(await emit("input", { text: "/model", source: "interactive" })).toBeUndefined();

    await emit("input", { text: "c", source: "interactive" });
    await emit("input", { text: "1", source: "interactive" });
    expect(notes.some(note => note.includes("chose"))).toBe(true);

    expect(await emit("input", { text: "exit", source: "interactive" })).toEqual({ action: "handled", handled: true });
    expect(await emit("input", { text: "back to the agent", source: "interactive" })).toBeUndefined();
  } finally { await emit("session_shutdown"); }
});

test("the overlay renders a boxed panel, follows the story, and closes", async () => {
  const { commands, notes, ctx, emit, overlay } = harness();
  await emit("session_start");
  try {
    await commands.get("sl")!.handler(`pack ${new URL("../stories/ghost-wire.lor", import.meta.url).pathname}`, ctx);
    await commands.get("sl")!.handler("overlay", ctx);
    expect(overlay.options.overlay).toBe(true);
    expect(overlay.options.overlayOptions.nonCapturing).toBe(true);
    const plain = (lines: string[]) => lines.map(line => line.replace(/\u001b\[[0-9;]*m/g, ""));
    const first = plain(overlay.component.render(50));
    expect(first[0].startsWith("┌")).toBe(true);
    expect(first.at(-1)!.startsWith("└")).toBe(true);
    expect(new Set(first.map(line => line.length)).size).toBe(1);

    await commands.get("sl")!.handler("enter", ctx);
    expect(plain(overlay.component.render(50)).some(line => line.includes("1. Free WREN"))).toBe(true);

    const before = overlay.renders;
    overlay.component.handleInput("1");
    await Bun.sleep(100);
    expect(overlay.renders).toBeGreaterThan(before);
    expect(plain(overlay.component.render(50)).some(line => line.includes("terrible password"))).toBe(true);
    expect(notes.some(note => note.includes("terrible password"))).toBe(false);

    overlay.component.handleInput("x");
    expect(overlay.closed).toBe(true);
  } finally { await emit("session_shutdown"); }
});
