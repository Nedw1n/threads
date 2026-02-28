import { Action, ActionPanel, Clipboard, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { parseBatchInput } from "./lib/doi";
import { fetchMetadata } from "./lib/crossref";
import { buildAPACitation, buildAPACitationMarkdown } from "./lib/apa";
import { ArticleMetadata, CitationResult } from "./lib/types";

const EMPTY_METADATA: ArticleMetadata = {
  authors: [],
  year: "",
  title: "",
  journal: "",
  volume: "",
  issue: "",
  pages: "",
  articleNumber: "",
  doi: "",
};

export default function Command() {
  const { push } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Generate Citations"
            icon={Icon.Document}
            onSubmit={async (values: { dois: string }) => {
              const dois = parseBatchInput(values.dois);
              if (dois.length === 0) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "No valid DOIs found",
                  message: "Enter at least one DOI starting with 10.",
                });
                return;
              }
              push(<CitationResults dois={dois} />);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="dois"
        title="DOIs"
        placeholder={`Paste one or more DOIs, e.g.:\n10.1002/btm2.10220\nhttps://doi.org/10.1038/s41586-020-2649-2`}
        info="Separate multiple DOIs with newlines, commas, or semicolons. URLs and doi: prefixes are handled automatically."
      />
    </Form>
  );
}

function CitationResults({ dois }: { dois: string[] }) {
  const [results, setResults] = useState<CitationResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Fetching ${dois.length} citation${dois.length > 1 ? "s" : ""}...`,
      });

      const fetched: CitationResult[] = [];

      for (const doi of dois) {
        if (cancelled) return;
        try {
          const metadata = await fetchMetadata(doi);
          const citation = buildAPACitation(metadata);
          fetched.push({ doi, metadata, citation });
        } catch (e) {
          fetched.push({
            doi,
            metadata: { ...EMPTY_METADATA, doi },
            citation: "",
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      }

      if (cancelled) return;

      // Sort: successful citations alphabetically (APA), errors at end
      fetched.sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        return a.citation.localeCompare(b.citation, undefined, { sensitivity: "base" });
      });

      setResults(fetched);
      setIsLoading(false);

      const successCount = fetched.filter((r) => !r.error).length;
      const errorCount = fetched.filter((r) => r.error).length;

      if (errorCount === 0) {
        toast.style = Toast.Style.Success;
        toast.title = `${successCount} citation${successCount > 1 ? "s" : ""} generated`;
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = `${successCount} succeeded, ${errorCount} failed`;
      }
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [dois]);

  const successResults = results.filter((r) => !r.error);

  async function copyAllCitations() {
    const all = successResults.map((r) => r.citation).join("\n\n");
    await Clipboard.copy(all);
    await showToast({ style: Toast.Style.Success, title: "All citations copied" });
  }

  return (
    <List isLoading={isLoading} isShowingDetail>
      {results.map((result) => (
        <List.Item
          key={result.doi}
          title={result.error ? result.doi : getShortLabel(result)}
          icon={result.error ? Icon.ExclamationMark : Icon.Document}
          detail={
            <List.Item.Detail
              markdown={
                result.error
                  ? `### Error\n\nFailed to fetch citation for \`${result.doi}\`:\n\n${result.error}`
                  : `### Citation\n\n${buildAPACitationMarkdown(result.metadata)}\n\n---\n*Plain text copied to clipboard on action.*`
              }
            />
          }
          actions={
            <ActionPanel>
              {!result.error && (
                <>
                  <Action.CopyToClipboard title="Copy Citation" content={result.citation} />
                  {successResults.length > 1 && (
                    <Action title="Copy All Citations" icon={Icon.Clipboard} onAction={copyAllCitations} />
                  )}
                  <Action.Paste title="Paste Citation" content={result.citation} />
                  <Action.OpenInBrowser title="Open DOI in Browser" url={`https://doi.org/${result.doi}`} />
                </>
              )}
              {result.error && (
                <Action.OpenInBrowser title="Open DOI in Browser" url={`https://doi.org/${result.doi}`} />
              )}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function getShortLabel(result: CitationResult): string {
  const firstAuthor = result.metadata.authors[0];
  const name = firstAuthor?.family || firstAuthor?.name || result.metadata.title.slice(0, 30);
  return `${name} (${result.metadata.year})`;
}
