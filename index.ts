import { installExtension, type ExtensionHost } from "./src/extension.js";

export default function shadowland(pi: ExtensionHost): void {
  installExtension(pi);
}
