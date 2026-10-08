import { test, expect } from "bun:test";
import { LorelineRuntime, parseLorelineStory } from "../src/loreline.js";
import { Playback } from "../src/playback.js";

const source = `character a
  name: Ada
  trust: 1
character b
  name: Bea
character c
  name: Cy
state
  heat: 0
function double(value)
  return value * 2
beat Start
  seed_random(123)
  a: I have the key.
  b: I have the map.
  c: I have a bad feeling.
  a: Then you decide.
  choice
    Quiet route
      heat = 1
      -> Route
    Noisy route
      heat = 3
      a.trust += 1
      -> Route
beat Route
  if heat > 2
    b: Noise cost $double(heat) credits.
  else
    b: Silence cost $double(heat) credits.
  a: My trust is $a.trust.
  c: I saw $random(1, 99) guards.
  b: We keep moving.
  -> End
beat End
  c: The final roll is $random(1, 99).
  a: We escaped with heat $heat and trust $a.trust.
  -> .
`;
const story = parseLorelineStory({ format: "loreline", version: 1, id: "choice-test", title: "Choice test", description: "Stateful branching", source });

test("a restored choice changes variables, character fields, and scripted calculations", async () => {
  const original = new LorelineRuntime(story);
  let saved;
  try {
    const first = await original.next();
    expect(first.scene.lines.map(line => line.speaker)).toEqual(["Ada", "Bea", "Cy", "Ada"]);
    saved = JSON.parse(JSON.stringify(first.checkpoint));
  } finally { await original.close(); }
  const resumed = new LorelineRuntime(story, saved);
  try {
    const branch = await resumed.choose(1);
    expect(branch.scene.lines[0].text).toBe("Noise cost 6 credits.");
    expect(branch.scene.lines[1].text).toBe("My trust is 2.");
    expect(branch.scene.choices).toBeUndefined();
  } finally { await resumed.close(); }
});

test("checkpoint continuation neither repeats lines nor rerolls random dialogue", async () => {
  const original = new LorelineRuntime(story);
  let resumed: LorelineRuntime | undefined;
  try {
    await original.next();
    const branch = await original.choose(1);
    const expected = await original.next();
    expect(expected.scene.lines[1].text).toBe("We escaped with heat 3 and trust 2.");
    resumed = new LorelineRuntime(story, JSON.parse(JSON.stringify(branch.checkpoint)));
    const actual = await resumed.next();
    expect(actual.scene.lines).toEqual(expected.scene.lines);
    expect(actual.checkpoint.finished).toBe(true);
  } finally { await original.close(); await resumed?.close(); }
});

test("waiting stories don't advance on new reasoning blocks; choices preserve history", async () => {
  const playback = new Playback();
  let resumed: Playback | undefined;
  try {
    await playback.useStory(story);
    const waiting = playback.scene("first");
    expect(playback.scene("still-working")).toEqual(waiting);
    await expect(playback.choose(99)).rejects.toThrow();
    resumed = new Playback(JSON.parse(JSON.stringify(playback.snapshot())));
    await resumed.initialize();
    await resumed.choose(1);
    expect(resumed.scene("new-block").lines[0].text).toBe("Silence cost 2 credits.");
    expect(resumed.scene("first")).toEqual(waiting);
  } finally { await playback.close(); await resumed?.close(); }
});

test("a rejected script leaves the active campaign and its cursor intact", async () => {
  const playback = new Playback();
  try {
    const historical = playback.scene("first");
    await expect(playback.useStory({ ...story, source: "not a Loreline story" })).rejects.toThrow();
    expect(playback.scene("first")).toEqual(historical);
    expect(playback.scene("next").beat).toBe(2);
  } finally { await playback.close(); }
});

test("a stale choice cannot select a later decision with the same option number", async () => {
  const runtime = new LorelineRuntime({ ...story, source: `character a
  name: Ada
character b
  name: Bea
beat Start
  choice
    Enter
      choice
        Leave
          a: You left.
          b: We are outside.
          -> .
        Stay
          a: You stayed.
          b: We are inside.
          -> .
` });
  try {
    const first = await runtime.next();
    const second = await runtime.choose(0, first.scene.choiceId);
    // Assert via try/catch: bun's `.rejects` doesn't see replies from worker round-trips.
    const stale = await runtime.choose(0, first.scene.choiceId).then(() => undefined, (error: unknown) => String(error));
    expect(stale).toContain("no longer current");
    expect((await runtime.choose(1, second.scene.choiceId)).scene.lines[0].text).toBe("You stayed.");
  } finally { await runtime.close(); }
});
