import { Clipboard } from "@raycast/api";
import { CiteCommand } from "./cite";

async function getClipboardInput(): Promise<string | null> {
  return (await Clipboard.readText())?.trim() ?? null;
}

/** "Cite From Clipboard" command — reads the clipboard on launch and auto-resolves it as a DOI or URL. */
export default function Command() {
  return <CiteCommand getInitialInput={getClipboardInput} />;
}
