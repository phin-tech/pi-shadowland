import { plainText } from "./story.js";
import type { Scene } from "./story.js";

export interface PanelHooks {
  scene(): Scene;
  title(): string;
  choose(number: number): void;
  advance(): void;
  close(): void;
  focused(): boolean;
  release(): void;
}

const BRIGHT = "\u001b[97m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    let rest = word;
    while (rest.length > width) {
      if (line) { lines.push(line); line = ""; }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (line && line.length + 1 + rest.length > width) { lines.push(line); line = rest; }
    else line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Display text is sanitized by plainText; only this module adds styling. Safe for both Pi and OMP TUIs. */
export class StoryPanel {
  constructor(private hooks: PanelHooks) {}

  render(width: number): string[] {
    const inner = Math.max(10, width - 4);
    const scene = this.hooks.scene();
    const body: string[] = [];
    for (const line of scene.lines) {
      const wrapped = wrap(`${plainText(line.speaker)}: ${plainText(line.text)}`, inner);
      const colon = wrapped[0].indexOf(":");
      wrapped[0] = `${BOLD}${wrapped[0].slice(0, colon)}${RESET}${BRIGHT}${wrapped[0].slice(colon)}`;
      body.push(...wrapped.map(text => `${BRIGHT}${text}${RESET}`), "");
    }
    scene.choices?.forEach((option, index) => {
      const label = `${index + 1}. ${plainText(option.text)}${option.enabled ? "" : " (unavailable)"}`;
      body.push(...wrap(label, inner).map(text => `${option.enabled ? BRIGHT : DIM}${text}${RESET}`));
    });
    if (scene.choices) body.push("");
    const keys = scene.choices ? `1-${scene.choices.length} choose` : "c continue";
    const hint = this.hooks.focused() ? `${keys} · esc release · x close` : `${keys} · x close · /sl focus to type here`;
    body.push(`${DIM}${hint}${RESET}`);

    const title = ` ${plainText(this.hooks.title()).slice(0, Math.max(1, inner - 4))} `;
    const top = `┌─${title}${"─".repeat(Math.max(0, width - title.length - 3))}┐`;
    const pad = (text: string) => {
      const visible = text.replace(/\u001b\[[0-9;]*m/g, "").length;
      return `│ ${text}${" ".repeat(Math.max(0, inner - visible))} │`;
    };
    return [top, ...body.map(pad), `└${"─".repeat(Math.max(0, width - 2))}┘`];
  }

  // Receives keys only when the host gives the overlay focus (OMP); Pi routes typing through story mode.
  handleInput(data: string): void {
    if (/^[1-9]$/.test(data)) this.hooks.choose(Number(data));
    else if (data === "c" || data === "\r" || data === "\n") this.hooks.advance();
    else if (data === "x") this.hooks.close();
    else if (data === "\u001b") this.hooks.release();
  }

  invalidate(): void {}
}
