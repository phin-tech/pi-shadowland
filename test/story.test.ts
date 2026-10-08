import { test, expect } from "bun:test";
import { createState, nextScene, formatScene } from "../src/story.js";
import { parsePack } from "../src/packs.js";
import { Playback } from "../src/playback.js";

const first = nextScene(createState(42)).scene;
const pack = { version: 1, id: "sample", title: "Sample", description: "A completed job", characters: first.characters, scenes: [first] };

test("redraws and session restore don't consume extra beats", () => {
  const playback = new Playback();
  const initial = playback.scene("message-1");
  expect(playback.scene("message-1")).toEqual(initial);
  const saved = JSON.parse(JSON.stringify(playback.snapshot()));
  const resumed = new Playback(saved);
  expect(resumed.scene("message-1")).toEqual(initial);
  expect(resumed.scene("message-2")).toEqual(playback.scene("message-2"));
  expect(resumed.snapshot().state.cursor).toBe(2);
});

test("serialized story cursor preserves episode transitions without mutating input", () => {
  let state = createState(31);
  for (let i = 0; i < 27; i++) state = nextScene(state).state;
  const before = structuredClone(state);
  const continuation = nextScene(state);
  expect(state).toEqual(before);
  expect(continuation.scene.episode).toBe(2);
  expect(continuation.scene.beat).toBe(1);
  expect(nextScene(JSON.parse(JSON.stringify(state)))).toEqual(continuation);
});

test("changing packs preserves previously displayed conversations", () => {
  const playback = new Playback();
  const archive = playback.scene("old");
  const custom = structuredClone(first);
  custom.id = "custom-scene";
  custom.lines[0].text = "The courier is home. We can close the channel.";
  playback.usePack(parsePack({ ...pack, scenes: [custom] }));
  expect(playback.scene("new")).toEqual(custom);
  expect(playback.scene("old")).toEqual(archive);
  const resumed = new Playback(JSON.parse(JSON.stringify(playback.snapshot())));
  expect(resumed.scene("new")).toEqual(custom);
  expect(resumed.snapshot().packCursor).toBe(1);
});

test("public packs reject ambiguous ids and terminal control injection", () => {
  expect(() => parsePack({ ...pack, scenes: [first, first] })).toThrow("Duplicate scene id");
  const unsafe = structuredClone(first);
  unsafe.lines[0].text = "hello\x1b]52;c;clipboard\x07";
  expect(() => parsePack({ ...pack, scenes: [unsafe] })).toThrow("control characters");
  unsafe.lines[0].text = "concealed\u202ecommand";
  expect(() => parsePack({ ...pack, scenes: [unsafe] })).toThrow("control characters");
});

test("a dialogue scene must include both characters", () => {
  const single = structuredClone(first);
  for (const line of single.lines) line.speaker = "NULL";
  expect(() => parsePack({ ...pack, scenes: [single] })).toThrow("both characters");
});

test("formatting renders phrases as text, not terminal commands or Markdown links", () => {
  const scene = structuredClone(first);
  scene.lines[0].text = "\x1b[31m[credit](https://example.com)\x1b[0m <script>";
  const displayed = formatScene(scene);
  expect(displayed).not.toContain("\x1b");
  expect(displayed).toContain("\\[credit\\]\\(https://example\\.com\\)");
  expect(displayed).toContain("&lt;script&gt;");
});

test("custom casts survive playback, restore, and pack exhaustion", () => {
  const characters = [
    { name: "Frodo", persona: "A weary but resolute traveler" },
    { name: "Sam", persona: "A practical, loyal companion" },
  ];
  const scene = { ...structuredClone(first), characters, lines: [
    { speaker: "Frodo", text: "The map has a bridge. The road disagrees." },
    { speaker: "Sam", text: "Then we ask the river, not the map." },
  ] };
  const custom = parsePack({ ...pack, characters, scenes: [scene] });
  const playback = new Playback();
  playback.usePack(custom);
  expect(playback.render("first")).toContain("Frodo:");
  const resumed = new Playback(JSON.parse(JSON.stringify(playback.snapshot())));
  expect(resumed.render("first")).toBe(playback.render("first"));
  const completed = resumed.scene("next");
  expect(completed.characters).toEqual(characters);
  expect(completed.lines.map(line => line.speaker)).toEqual(["Frodo", "Sam"]);
  const badScene = { ...scene, lines: [{ speaker: "NULL", text: "Wrong cast" }, scene.lines[1]] };
  expect(() => parsePack({ ...pack, characters, scenes: [badScene] })).toThrow("cast");
});
