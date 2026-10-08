# pi-shadownet

Display fictional conversations in place of visible assistant reasoning. Tools and final answers retain their normal rendering. The real reasoning stays in the host's messages and provider context; the fiction is labeled **SHADOWNET · fictional comms**.

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

## Built-in campaign

NULL is a cautious veteran decker. HEX is an impulsive, streetwise improviser. The authored serial interleaves corporate evidence theft, a neighborhood clinic's debt, and a captive Matrix courier. Each episode has 27 exchanges, including payoffs and aftermath. Seeded madlib details remain stable within an episode; later episodes acknowledge completed jobs rather than undoing their endings.

A reasoning block gets a short exchange, not one new exchange per token. Streaming updates and redraws reuse it. Story progress and selected pack snapshots are stored with `appendEntry`, outside model context, and restored from the active session branch. Do not use `--no-session` if you want durable continuity.

Pi's public transformer identifies content by Markdown, not message id: identical reasoning passages may share their first exchange. OMP's experimental adapter identifies individual blocks by message timestamp and content index. Historical blocks without saved assignments are assigned exchanges when first displayed.

Commands:

```text
/shadownet status
/shadownet on
/shadownet off
/shadownet pack /absolute/path/to/stories/ghost-wire.json
/shadownet pack https://raw.githubusercontent.com/OWNER/REPO/COMMIT/stories/ghost-wire.json
```

On/off applies on the next transcript redraw. Switch packs while idle. Existing saved exchanges retain their original text; a new pack starts on the next unassigned block. A finite pack ends with a holding exchange in the same cast, not a restart or a switch to unrelated characters.

To choose a pack at startup:

```sh
SHADOWNET_PACK="$PWD/stories/ghost-wire.json" pi -e "$PWD/index.ts"
SHADOWNET_PACK="$PWD/stories/ghost-wire.json" omp -e "$PWD/omp.ts"
```

The environment selection applies only to sessions without a saved Shadownet checkpoint. Resumed sessions keep their saved pack and cursor. Loading errors at startup produce a warning and use the built-in campaign; errors from `/shadownet pack` leave the current pack unchanged. URLs fetch once on selection, not during each reasoning update. Resume uses the saved snapshot rather than downloading a changed remote pack.

## Generate, review, and host packs

Bun is required for the publishing CLI. The terminal extension does not require Bun when used with Pi.

```sh
bun install
bun run stories builtin --out stories/new-run.json --seed 123
bun run stories preview stories/new-run.json
bun run stories validate stories/new-run.json
```

`stories/ghost-wire.json` is a ready-to-publish 27-scene authored pack. `builtin` produces another reproducible madlib variant without calling any model. Output files are never overwritten.

Cheap-model generation is explicit and separate from coding. Set an OpenAI-compatible model and endpoint:

```sh
export SHADOWNET_MODEL=gpt-4o-mini
export SHADOWNET_API_KEY="$OPENAI_API_KEY"
# Optional: SHADOWNET_BASE_URL, default https://api.openai.com/v1

bun run stories generate \
  --id haunted-chip \
  --premise "NULL and HEX recover a datachip that keeps delivering messages from a dead fixer. Interleave a clinic debt and their growing distrust of the client." \
  --scenes 12 \
  --out stories/haunted-chip.json
```

Generation accepts 6–24 ordered scenes in one request. The request includes only the cast and fictional premise, never your coding conversation, files, tool output, or actual reasoning. It has a 15-second timeout and a bounded output-token budget. A local OpenAI-compatible server can use `SHADOWNET_BASE_URL` without an API key. `SHADOWNET_API_KEY` takes precedence over `OPENAI_API_KEY`.

To rewrite one scene's dialogue while retaining its metadata and intended canon:

```sh
bun run stories augment stories/haunted-chip.json \
  --scene 3 --out stories/haunted-chip-remix.json
```

The prompt asks the model to preserve canon; structural validation cannot prove narrative continuity. Review generated scenes before publishing. Failed, malformed, truncated, or invalid responses fail explicitly instead of producing a pretend pack.

### Book-character casts

Use `--cast` with a JSON array of exactly two `{ "name", "persona" }` objects. Character names are used as the dialogue speakers; persona descriptions establish voices and relationships. `casts/fantasy-companions.json` demonstrates Frodo and Sam:

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
3. Select its **raw** URL with `/shadownet pack` or `SHADOWNET_PACK`. A normal GitHub HTML/blob URL is not JSON. Pin a commit SHA for reproducible content.

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

Array order is playback order. Packs contain 1–100 uniquely identified scenes, each with 2–4 lines and both cast members. Lines are at most 240 characters. Terminal controls and invisible formatting characters are rejected; rendering escapes Markdown and HTML. Remote/local JSON is bounded to 1 MiB. The cast is attached to parsed scene snapshots automatically.

## Verification

```sh
bun run check
bun test
```

Exercised: real Pi 0.85.1 and OMP 18.8.5 ANSI terminal replay and live reasoning streaming with a local provider fixture; preservation of canonical reasoning in both saved sessions; OMP shutdown without raw-reasoning repaint; OMP resume retaining the first exchange and advancing to the next saved-pack beat; a custom Frodo/Sam pack in the Pi terminal; generate/augment/validate/preview CLI flows; HTTP-hosted pack loading; malformed completion rejection and request cancellation.

No paid generation provider, actual GitHub publication, Tern native surface, or host-upgrade compatibility was exercised. Narrative quality of a chosen cheap model remains something to review, not an assertion of the fixture smoke runs.
