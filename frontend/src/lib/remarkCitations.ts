import { visit } from "unist-util-visit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remarkCitations = () => (tree: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(tree, "text", (node: any, index: any, parent: any) => {
    if (index == null || !parent) return;

    const parts = (node.value as string).split(/(\[\d+\])/g);
    if (parts.length <= 1) return;

    const newNodes = parts
      .filter((p) => p !== "")
      .map((part) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          return {
            type: "citationMarker" as const,
            data: {
              hName: "citation-marker",
              hProperties: { n: String(parseInt(match[1]) - 1) },
            },
          };
        }
        return { type: "text" as const, value: part };
      });

    parent.children.splice(index, 1, ...(newNodes as never[]));
  });
};

export default remarkCitations;
