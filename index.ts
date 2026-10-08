import { installExtension, type ExtensionHost } from "./src/extension.js";

export default function shadownet(pi: ExtensionHost): void {
  installExtension(pi);
}
