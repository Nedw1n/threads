import { Clipboard, LaunchProps, showHUD, showToast, Toast } from "@raycast/api";
import { parseBatchInput } from "./lib/doi";
import { fetchMetadata } from "./lib/crossref";
import { buildAPACitation } from "./lib/apa";

interface Arguments {
  doi?: string;
}

export default async function Command(props: LaunchProps<{ arguments: Arguments }>) {
  const argDoi = props.arguments.doi?.trim();

  try {
    // Use argument if provided, otherwise read clipboard
    let rawInput: string;

    if (argDoi) {
      rawInput = argDoi;
    } else {
      const toast = await showToast({ style: Toast.Style.Animated, title: "Reading clipboard..." });
      const clipboardText = await Clipboard.readText();
      toast.hide();

      if (!clipboardText) {
        await showHUD("No text found on clipboard");
        return;
      }
      rawInput = clipboardText;
    }

    const dois = parseBatchInput(rawInput);

    if (dois.length === 0) {
      await showHUD("No valid DOIs found");
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Fetching ${dois.length} citation${dois.length > 1 ? "s" : ""}...`,
    });

    const citations: string[] = [];
    const errors: string[] = [];

    for (const doi of dois) {
      try {
        const metadata = await fetchMetadata(doi);
        citations.push(buildAPACitation(metadata));
      } catch {
        errors.push(doi);
      }
    }

    toast.hide();

    if (citations.length === 0) {
      await showHUD("Failed to fetch citations");
      return;
    }

    // APA requires alphabetical sorting by first author
    citations.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const result = citations.join("\n\n");
    await Clipboard.copy(result);

    let message = `${citations.length} citation${citations.length > 1 ? "s" : ""} copied`;
    if (errors.length > 0) {
      message += ` (${errors.length} failed)`;
    }
    await showHUD(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await showHUD(`Error: ${message}`);
  }
}
