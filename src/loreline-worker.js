import { parentPort, workerData } from "node:worker_threads";
import { Loreline, Interpreter } from "loreline";

const { story, checkpoint } = workerData;
let interpreter;
let pending;
let characters;
let cursor = checkpoint?.cursor ?? 0;
let rng = checkpoint?.rng ?? 42;
let initialized = false;
let awaken;
function suspend(value) {
  pending = value;
  awaken?.();
  awaken = undefined;
}
async function waitForSuspension() {
  if (pending) return;
  const { promise, resolve } = Promise.withResolvers();
  awaken = resolve;
  await promise;
}
// All randomness is local to this worker and travels with the checkpoint.
Math.random = () => {
  rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
  return rng / 0x100000000;
};

function initialize() {
  const script = Loreline.parse(story.source, `${story.id}.lor`, () => { throw new Error("Loreline imports are disabled; publish self-contained .lor stories"); });
  if (!script) throw new Error(String(Loreline.lastError() || "Loreline parse failed"));
  const ast = script.toJson();
  const identifiers = ast.body.filter(node => node.type === "Character").map(node => node.name);
  if (identifiers.length < 2) throw new Error("A Shadowland conversation needs at least two Loreline characters");
  const onDialogue = (runtime, character, text, _tags, advance) => {
    const name = character === null ? "Narrator" : runtime.getCharacterField(character, "name") || character;
    suspend({ kind: "dialogue", line: { speaker: String(name), text }, advance });
  };
  const onChoice = (runtime, options, select) => {
    suspend({ kind: "choice", choiceId: `${story.id}:${runtime.currentNode().id.toString()}`, options: options.map(({ text, enabled }) => ({ text, enabled })), select });
  };
  const onFinish = () => { suspend({ kind: "finish" }); };
  interpreter = new Interpreter(script, onDialogue, onChoice, onFinish, {
    strictAccess: true,
    functions: { seed_random(seed) { rng = Number(seed) >>> 0; return null; } },
  });
  if (checkpoint) {
    interpreter.restore(checkpoint.data);
    if (checkpoint.finished) pending = { kind: "finish" };
    else interpreter.resume();
    // Resume can reevaluate the pending line; retain its exact rendered value.
    if (checkpoint.pendingLine && pending?.kind === "dialogue") pending.line = checkpoint.pendingLine;
    rng = checkpoint.rng;
  } else interpreter.start();
  characters = identifiers.map(identifier => ({
    name: String(interpreter.getCharacterField(identifier, "name") || identifier),
    persona: String(interpreter.getCharacterField(identifier, "persona") || "Character portrayed in the authored Loreline story"),
  }));
  if (!characters.some(character => character.name === "Narrator")) characters.push({ name: "Narrator", persona: "Authored narration" });
  initialized = true;
}

async function step(action, index, choiceId) {
  if (!initialized) initialize();
  await waitForSuspension();
  if (action === "choose") {
    if (pending?.kind !== "choice") throw new Error("The story is not waiting for a choice");
    if (choiceId !== undefined && pending.choiceId !== choiceId) throw new Error("That choice is no longer current");
    if (!Number.isSafeInteger(index) || index < 0 || index >= pending.options.length || !pending.options[index].enabled) throw new Error("Choose an enabled option from the displayed list");
    const select = pending.select;
    pending = undefined;
    select(index);
    await waitForSuspension();
  }
  const lines = [];
  while (pending?.kind === "dialogue" && lines.length < 4) {
    const { line, advance } = pending;
    lines.push(line);
    pending = undefined;
    advance();
    await waitForSuspension();
  }
  if (!pending) throw new Error("Loreline did not suspend at dialogue, a choice, or story completion");
  const finished = pending.kind === "finish";
  if (lines.length) cursor++;
  const choices = pending.kind === "choice" ? pending.options : undefined;
  if (!lines.length && finished) {
    lines.push({ speaker: characters[0].name, text: "Our tale rests here." }, { speaker: characters[1].name, text: "Until the next story begins." });
  }
  const scene = {
    id: `${story.id}-${Math.max(1, cursor)}${choices ? `-choice-${pending.choiceId.split(":")[1]}` : ""}${finished ? "-end" : ""}`,
    title: finished ? "Story complete" : story.title,
    episode: 1, beat: Math.max(1, cursor),
    canon: finished ? "The authored story has ended." : "Dialogue and choices from the authored Loreline script.",
    characters, lines, ...(choices ? { choices, choiceId: pending.choiceId } : {}),
  };
  const data = interpreter.save();
  return { scene, checkpoint: { data, cursor, finished, rng, ...(pending.kind === "dialogue" ? { pendingLine: pending.line } : {}) } };
}

let commands = Promise.resolve();
parentPort.on("message", ({ id, action, index, choiceId }) => {
  commands = commands.then(async () => {
    try { parentPort.postMessage({ id, result: await step(action, index, choiceId) }); }
    catch (error) { parentPort.postMessage({ id, error: String(error) }); }
  });
});
