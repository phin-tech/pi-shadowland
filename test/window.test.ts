import { test, expect } from "bun:test";
import { Playback } from "../src/playback.js";
import { startStoryWindow } from "../src/window.js";

test("window actions reject missing authorization, foreign origins, and stale controls", async () => {
  const playback = new Playback();
  const window = await startStoryWindow({
    view: () => ({ ...playback.view(), agentActive: false }),
    choose: async (index, id) => { await playback.choose(index, id); },
    advance: async (id, generation) => { await playback.advance(id, generation); },
  });
  try {
    const url = new URL(window.url);
    const token = url.hash.slice(1);
    const view = playback.view();
    const body = JSON.stringify({ sceneId: view.scene.id, generation: view.generation });
    const action = `${url.origin}/advance`;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    expect((await fetch(action, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(401);
    expect((await fetch(action, { method: "POST", headers: { ...headers, Origin: "https://unrelated.example" }, body })).status).toBe(403);
    expect(playback.view().scene.beat).toBe(1);
    expect((await fetch(action, { method: "POST", headers, body })).status).toBe(200);
    expect(playback.view().scene.beat).toBe(2);
    expect((await fetch(action, { method: "POST", headers, body })).status).toBe(409);
    expect(playback.view().scene.beat).toBe(2);
  } finally { await window.close(); await playback.close(); }
});
