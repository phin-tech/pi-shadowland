import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";
import type { StoryView } from "./playback.js";

export interface WindowView extends StoryView { agentActive: boolean }
export interface WindowHooks {
  view(): WindowView;
  choose(index: number, choiceId: string): Promise<void>;
  advance(sceneId: string, generation: number): Promise<void>;
}
export interface StoryWindow { url: string; publish(): void; close(): Promise<void> }

/** Only fictional view data crosses this loopback-only, bearer-authenticated bridge. */
export async function startStoryWindow(hooks: WindowHooks): Promise<StoryWindow> {
  const token = randomBytes(32).toString("base64url");
  const assets: Record<string, { type: string; data: string }> = {};
  for (const [path, file, type] of [["/", "index.html", "text/html"], ["/window.css", "window.css", "text/css"], ["/window.js", "window.js", "text/javascript"]]) {
    assets[path] = { type, data: await readFile(new URL(`./window/${file}`, import.meta.url), "utf8") };
  }
  const clients = new Set<ServerResponse>();
  let origin = "";
  let busy = false;
  let lastFrame = "";
  const publish = () => {
    if (!clients.size) return;
    const frame = JSON.stringify(hooks.view());
    if (frame === lastFrame) return;
    lastFrame = frame;
    for (const client of clients) client.write(`data: ${frame}\n\n`);
  };
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      const json = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      try {
        if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) { json(403, { error: "Foreign origin rejected" }); return; }
        const path = new URL(request.url ?? "/", origin).pathname;
        if (request.method === "GET" && assets[path]) { response.writeHead(200, { "Content-Type": `${assets[path].type}; charset=utf-8` }); response.end(assets[path].data); return; }
        if (request.method === "GET" && path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
        if (request.headers.authorization !== `Bearer ${token}`) { json(401, { error: "Window authorization required" }); return; }
        if (request.method === "GET" && path === "/events") {
          response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
          clients.add(response);
          response.write(`data: ${JSON.stringify(hooks.view())}\n\n`);
          response.on("close", () => clients.delete(response));
          return;
        }
        if (request.method !== "POST" || (path !== "/choose" && path !== "/advance")) { json(404, { error: "Unknown window action" }); return; }
        if (busy) { json(409, { error: "A story action is already in progress" }); return; }
        if (request.headers["content-type"] !== "application/json") { json(415, { error: "Use JSON for story actions" }); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const raw of request) {
          const chunk: unknown = raw;
          if (!Buffer.isBuffer(chunk)) throw new Error("Invalid request body");
          size += chunk.byteLength;
          if (size > 4096) { json(413, { error: "Story action is too large" }); return; }
          chunks.push(chunk);
        }
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!input || typeof input !== "object" || Array.isArray(input)) { json(400, { error: "Invalid story action" }); return; }
        const action = input as Record<string, unknown>;
        if (busy) { json(409, { error: "A story action is already in progress" }); return; }
        const view = hooks.view();
        if (action.generation !== view.generation || action.sceneId !== view.scene.id || (path === "/choose" && action.choiceId !== view.scene.choiceId)) { json(409, { error: "The story changed; use the current controls" }); return; }
        busy = true;
        try {
          if (path === "/choose") {
            if (typeof action.index !== "number" || !Number.isSafeInteger(action.index) || typeof action.choiceId !== "string") throw new Error("Invalid choice");
            await hooks.choose(action.index, action.choiceId);
          } else await hooks.advance(view.scene.id, view.generation);
          json(200, { ok: true });
          publish();
        } finally { busy = false; }
      } catch (error) { if (!response.headersSent) json(400, { error: String(error) }); else response.end(); }
    })();
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind the story window");
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  return {
    url: `${origin}/#${token}`,
    publish,
    close() {
      if (closing) return closing;
      const done = Promise.withResolvers<void>();
      closing = done.promise;
      for (const client of clients) client.end();
      clients.clear();
      server.close(error => error ? done.reject(error) : done.resolve());
      server.closeAllConnections();
      return closing;
    },
  };
}

export async function openStoryWindow(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const launched = Promise.withResolvers<void>();
  const child = spawn(command, args, { stdio: "ignore" });
  child.once("error", launched.reject);
  child.once("exit", code => code === 0 ? launched.resolve() : launched.reject(new Error(`Browser launcher exited (${code}); open the reported window URL manually`)));
  await launched.promise;
}
