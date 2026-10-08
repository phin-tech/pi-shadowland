# Shadowland

Shadowland (`pi-shadowland`) replaces visible assistant reasoning with fictional conversations between characters (two or more per pack). Packs define the cast, voices, setting, and ongoing story: fantasy companions, detectives, office comedy, legal absurdity, or cyberpunk deckers. Shadowrun-style comms are one theme, not a requirement. Tools and final answers retain their normal rendering. Real reasoning stays in the host's messages and provider context; fiction is labeled **SHADOWLAND · fictional dialogue**.

Repository: [phin-tech/pi-shadowland](https://github.com/phin-tech/pi-shadowland).

## Host support

| Host | Entry | Integration |
| --- | --- | --- |
| Pi 0.85.1 | `index.ts` | Public `registerMarkdownTransformer`, restricted to `assistant-thinking`. |
| Oh My Pi 18.8.5 | `omp.ts` | **Experimental:** reversible in-process wrapper of the exported assistant renderer's `updateContent`. No installed host files are changed. |

OMP's `registerAssistantThinkingRenderer` only appends below real thinking; it does not replace it. The experimental adapter uses an internal method and must be rechecked after host upgrades. It is not a public compatibility guarantee. A native display-transform hook would be preferable.

Keep thinking blocks visible. `Ctrl+T` / `--hide-thinking` can hide the fictional blocks too. This extension does not change reasoning effort, suppress provider reasoning, or replace the working spinner. It runs only in the main interactive terminal, not print/JSON/RPC modes or headless subagents.

Load explicitly while trying it. Use absolute extension paths when resuming a session whose working directory is elsewhere:

```sh
pi -e "$PWD/index.ts"
omp -e "$PWD/omp.ts"
```

Both package manifests are included for installing the checkout through the host's package manager. No installation or settings change is performed automatically.

## Story packs and the default campaign

NULL is a cautious veteran decker. HEX is an impulsive, streetwise improviser. The authored serial interleaves corporate evidence theft, a neighborhood clinic's debt, and a captive Matrix courier. Each episode has 27 exchanges, including payoffs and aftermath. Seeded madlib details remain stable within an episode; later episodes acknowledge completed jobs rather than undoing their endings.

For a ready-to-play non-cyberpunk theme, `stories/river-crossing.json` contains six original Frodo/Sam exchanges about a lost bridge, a negotiated toll, and accepting help. It is unofficial fan fiction, not an excerpt from a book. Choose either pack using the same command and loader; casts and dialogue are pack data, not hard-coded renderer roles.

A reasoning block gets a short exchange, not one new exchange per token. Streaming updates and redraws reuse it. Story progress and selected pack snapshots are stored with `appendEntry`, outside model context, and restored from the active session branch. Do not use `--no-session` if you want durable continuity.

Pi's public transformer identifies content by Markdown, not message id: identical reasoning passages may share their first exchange. OMP's experimental adapter identifies individual blocks by message timestamp and content index. Historical blocks without saved assignments are assigned exchanges when first displayed.

Commands:

```text
/shadowland status
/shadowland on
/shadowland off
/shadowland pack /absolute/path/to/stories/river-crossing.json
/shadowland pack https://raw.githubusercontent.com/phin-tech/pi-shadowland/main/stories/ghost-wire.json
/shadowland pack /absolute/path/to/stories/ghost-wire.lor
/shadowland choose <number>
/shadowland window | both | terminal
/shadowland enter | exit | continue
/shadowland overlay | overlay off | focus
```

`/sl` is a short alias for every `/shadowland` command. Pass absolute paths inside the host: `$PWD` is not expanded in slash commands.

**Story mode.** `/sl enter` makes Shadowland swallow what you type, via the host's `input` hook (Pi and OMP): a number picks that choice, `c` or an empty Enter continues, and `exit` leaves. Nothing typed in story mode reaches the agent. Slash commands always pass through, so `/sl exit` works even if something goes wrong. Story mode is per-session and is not saved; a resumed session starts with input going to the agent.

On/off applies on the next transcript redraw. Switch packs while idle. Existing saved exchanges retain their original text; a new pack starts on the next unassigned block. A finite pack ends with a holding exchange in the same cast, not a restart or a switch to unrelated characters.

To choose a pack at startup:

```sh
SHADOWLAND_PACK="$PWD/stories/river-crossing.json" pi -e "$PWD/index.ts"
SHADOWLAND_PACK="$PWD/stories/river-crossing.json" omp -e "$PWD/omp.ts"
```

The environment selection applies only to sessions without a saved Shadowland checkpoint. Resumed sessions keep their saved pack and cursor. Loading errors at startup produce a warning and use the built-in campaign; errors from `/shadowland pack` leave the current pack unchanged. URLs fetch once on selection, not during each reasoning update. Resume uses the saved snapshot rather than downloading a changed remote pack.

## Interactive stories (Loreline)

Besides fixed JSON packs, a `.lor` file is an interactive [Loreline](https://www.npmjs.com/package/loreline) script with state, conditions, branching choices, and scripted calculations. `stories/ghost-wire.lor` is a four-character example (NULL, HEX, MOTH, WREN) with two decisions. Load it like any pack: `/shadowland pack /path/to/ghost-wire.lor`, or `SHADOWLAND_PACK`.

- Each reasoning block advances the story by up to four lines. At a choice the story **waits**; new reasoning blocks do not skip the decision. Choose with `/shadowland choose <number>` or in the companion window.
- Scripts run in a worker thread with a 2-second limit per step, no environment, and imports disabled. This bounds runaway scripts; it is not an OS sandbox, so review scripts from untrusted sources.
- Randomness is seeded and stored in the checkpoint, so resumed sessions replay the same lines and never reroll. Checkpoints (including the pending choice) are saved with `appendEntry` like other progress.
- Stale controls are rejected: a choice or continue button from an earlier decision cannot select an option in a later one.
- `bun run stories preview story.lor` plays a script interactively in a terminal; `validate` parses it and runs to the first dialogue/choice. `generate --out stories/name.lor` asks the configured model for a Loreline script and verifies it runs before saving.

## Floating overlay

`/sl overlay` shows the story as a small panel floating over the corner of the terminal, using the host's overlay API (Pi and OMP). It stays out of the transcript and updates as the story moves. Combined with story mode (`/sl enter`), choices are answered by typing the number.

Open and close it with `/sl overlay` (or `/sl overlay off`). With the panel open, notifications for story steps are suppressed so the text isn't shown twice. By default the Pi panel does not take keyboard focus: use story mode (`/sl enter`) and type the number or `c`; `x` closes it. To type straight into the panel instead, run `/sl focus` (it opens the panel if needed). While focused, `1`–`9` choose, `c` or Enter continues, `Esc` hands the keyboard back to the prompt, and `x` closes. The story has no free-text input, only choices and continue. OMP's overlay API has no non-capturing option, so there the panel may take focus and read the keys (`1`–`9`, `c`/Enter, `x`/Esc) directly. Verified against a fake host in tests; not yet seen in a live Pi or OMP session.

Illustrative layout (a mockup, not a captured screenshot):

```text
 ┌─ SHADOWLAND ──────────────────────────────┐
 │ NULL: Socket wants the violet tariff      │
 │ ledger out of Vesper Utility. Read-only   │
 │ extraction. Allegedly.                    │
 │                                           │
 │ HEX: A megacorp invoice? Finally, crime   │
 │ with a stationery budget.                 │
 │                                           │
 │ 1. Free WREN before copying the evidence  │
 │ 2. Copy the evidence before freeing WREN  │
 │                                           │
 │ 1-2 choose · x close · /sl focus to type  │
 └───────────────────────────────────────────┘
```

## Companion window

`/shadowland window` (or `both`) opens a local browser view of the story; `terminal` closes it. Set `SHADOWLAND_DISPLAY=terminal|window|both` to choose the startup mode for sessions without a saved choice. The window is the way to read and answer choices without touching the terminal.

- It binds to `127.0.0.1` on a random port. The URL carries a per-session bearer token in its fragment; requests without it, with a foreign `Origin`/`Host`, or carrying stale scene/generation ids are rejected.
- Only fictional story data crosses the bridge: no reasoning, code, or tool output.
- In `window` mode the terminal's reasoning is left alone, and the OMP renderer wrapper is not installed, so it also works on hosts without a replacement hook.

## Generate, review, and host packs

Bun is required for the publishing CLI. The terminal extension does not require Bun when used with Pi.

```sh
bun install
bun run stories builtin --out stories/new-run.json --seed 123
bun run stories preview stories/new-run.json
bun run stories validate stories/new-run.json
```

`stories/ghost-wire.json` is the 27-scene decker pack; `stories/river-crossing.json` is the six-scene fantasy pack. `builtin` produces a reproducible madlib variant of the default decker campaign without calling any model. Other themes use a custom cast and premise or a handwritten pack. Output files are never overwritten.

Cheap-model generation is explicit and separate from coding. Set an OpenAI-compatible model and endpoint:

```sh
export SHADOWLAND_MODEL=gpt-4o-mini
export SHADOWLAND_API_KEY="$OPENAI_API_KEY"
# Optional: SHADOWLAND_BASE_URL, default https://api.openai.com/v1

bun run stories generate \
  --id haunted-chip \
  --premise "NULL and HEX recover a datachip that keeps delivering messages from a dead fixer. Interleave a clinic debt and their growing distrust of the client." \
  --scenes 12 \
  --out stories/haunted-chip.json
```

Generation accepts 6–24 ordered scenes in one request. The request includes only the cast and fictional premise, never your coding conversation, files, tool output, or actual reasoning. It has a 15-second timeout and a bounded output-token budget. A local OpenAI-compatible server can use `SHADOWLAND_BASE_URL` without an API key. `SHADOWLAND_API_KEY` takes precedence over `OPENAI_API_KEY`.

To rewrite one scene's dialogue while retaining its metadata and intended canon:

```sh
bun run stories augment stories/haunted-chip.json \
  --scene 3 --out stories/haunted-chip-remix.json
```

The prompt asks the model to preserve canon; structural validation cannot prove narrative continuity. Review generated scenes before publishing. Failed, malformed, truncated, or invalid responses fail explicitly instead of producing a pretend pack.

### Any two characters

Use `--cast` with a JSON array of two or more `{ "name", "persona" }` objects with distinct names. Names become dialogue speakers; personas establish voices and relationships. No Shadowrun terminology is required. Create original characters for any genre, or use recognizable book characters for new fan-fiction scenes. `casts/fantasy-companions.json` demonstrates Frodo and Sam:

```sh
bun run stories generate \
  --id roadside-companions \
  --cast casts/fantasy-companions.json \
  --premise "An unofficial, original roadside adventure: Frodo and Sam negotiate a river crossing and learn to accept help. No book quotations." \
  --scenes 12 \
  --out stories/roadside-companions.json
```

Recognizable characters can be used for original fan-fiction dialogue. Do not copy passages, lyrics, or quotations into public packs. Label public franchise-derived packs unofficial and check applicable fan-content policies; this project does not grant rights to third-party characters or settings.

### GitHub hosting

1. Generate or hand-author a pack; preview and validate it.
2. Commit the JSON under `stories/` in a GitHub repository.
3. Select its **raw** URL with `/shadowland pack` or `SHADOWLAND_PACK`. A normal GitHub HTML/blob URL is not JSON. Pin a commit SHA for reproducible content.

GitHub Pages or any HTTP(S) static JSON host also works. GitHub publishing is manual; the CLI does not need GitHub credentials, create repositories, or push commits. Public URLs must be accessible without authentication. Packs are data, never executable extensions.

## Pack format

The same format works for generated and handwritten conversations. An abbreviated, valid single-scene example:

```json
{
  "version": 1,
  "id": "night-shift",
  "title": "Night Shift",
  "description": "Two deckers find a door the client forgot to mention.",
  "characters": [
    { "name": "NULL", "persona": "Cautious veteran decker with dry humor." },
    { "name": "HEX", "persona": "Impulsive streetwise decker, loyal to NULL." }
  ],
  "scenes": [
    {
      "id": "night-shift-1",
      "title": "Unlisted entrance",
      "episode": 1,
      "beat": 1,
      "canon": "The duo discovers a second locked entrance. They have not opened it.",
      "lines": [
        { "speaker": "NULL", "text": "The client sent one door code. There are two doors." },
        { "speaker": "HEX", "text": "Maybe the second one's an optional subscription." }
      ]
    }
  ]
}
```

Array order is playback order. Packs contain 1–100 uniquely identified scenes, each with 2–4 lines spoken by at least two cast members (larger casts can rotate). Lines are at most 240 characters. Terminal controls and invisible formatting characters are rejected; rendering escapes Markdown and HTML. Remote/local JSON is bounded to 1 MiB. The cast is attached to parsed scene snapshots automatically.

## Verification

```sh
bun run check
bun test
```

Exercised: real Pi 0.85.1 and OMP 18.8.5 ANSI terminal replay and live reasoning streaming with a local provider fixture; preservation of canonical reasoning in both saved sessions; OMP shutdown without raw-reasoning repaint; OMP resume retaining the first exchange and advancing to the next saved-pack beat; a custom Frodo/Sam pack in the Pi terminal; generate/augment/validate/preview CLI flows; HTTP-hosted pack loading; malformed completion rejection and request cancellation.

Shadowland cutover checks: TypeScript and 15 regression tests pass (including Loreline checkpoint/choice behavior and the window's auth and stale-control checks); the new fantasy pack validates and previews; `SHADOWLAND_MODEL` / `SHADOWLAND_BASE_URL` / `SHADOWLAND_API_KEY` drive generate and augment against a local provider fixture; `SHADOWLAND_PACK` loads fantasy dialogue into both terminal UIs; `/shadowland status` reports Pi progress; `/shadowland pack` selects the GitHub-hosted Ghost Wire pack in OMP and persists the selection under `shadowland-state`.

The earlier pack was published to GitHub and its raw URL validated. No paid generation provider, Tern native surface, or host-upgrade compatibility was exercised. Narrative quality of a chosen cheap model remains something to review, not an assertion of the fixture smoke runs.
