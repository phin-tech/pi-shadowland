import { installExtension } from "./src/extension.js";
import type { DisplayMessage, ExtensionHost } from "./src/extension.js";

const PATCH = Symbol.for("pi-shadowland.omp-renderer");

/** Explicit opt-in: OMP 18.8.5 has no public thinking-text replacement hook. */
export default function shadowlandOMP(pi: ExtensionHost): void {
  installExtension(pi, transform => {
    const prototype = pi.pi?.AssistantMessageComponent?.prototype;
    if (!prototype || typeof prototype.updateContent !== "function") {
      throw new Error("Shadowland: this OMP build does not expose the expected assistant renderer. Use window-only mode.");
    }
    const target = prototype as typeof prototype & { [PATCH]?: () => void };
    target[PATCH]?.();
    const update = target.updateContent;
    const sources = new WeakMap<DisplayMessage, DisplayMessage>();
    function wrapped(this: object, input: DisplayMessage, ...args: unknown[]): unknown {
      const message = sources.get(input) ?? input;
      const display = transform(message);
      if (display !== message) sources.set(display, message);
      return update.call(this, display, ...args);
    }
    target.updateContent = wrapped;
    function remove(): void {
      if (target.updateContent !== wrapped) return;
      target.updateContent = update;
      delete target[PATCH];
      // Do not repaint old rows during shutdown: that would expose raw reasoning
      // in the terminal's final frame. Session switches rebuild from canonical data.
    }
    target[PATCH] = remove;
    return remove;
  });
}
