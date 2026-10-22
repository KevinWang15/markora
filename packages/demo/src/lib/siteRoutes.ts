export const defaultDocumentMetadata = {
  title: "Markora — Embedded Markdown Editor",
  description: "Markora is a production-minded embedded Markdown editor with predictable fidelity, accessible interactions, host-owned lifecycle, and opt-in syntax packages.",
};

export const publicRouteMetadata: Record<string, typeof defaultDocumentMetadata> = {
  "/docs/components": {
    title: "Custom Components — Markora",
    description: "Mix Markdown with typed, editable custom components. Try the metrics-chart example and explore the registration API.",
  },
  "/": {
    title: "Core Playground — Markora",
    description: "Try Markora's embedded core editor and optional UI in a realistic host-controlled playground.",
  },
  "/docs/getting-started": {
    title: "Getting Started — Markora",
    description: "Install Markora, mount the embedded Markdown editor, and add only the UI and syntax packages your product needs.",
  },
  "/docs/markdown": {
    title: "Markdown Compatibility — Markora",
    description: "Review Markora's published Markdown dialect, exact-source fallback behavior, and opt-in semantic syntax packages.",
  },
  "/docs/api": {
    title: "API Reference — Markora",
    description: "Explore Markora's typed editor API for commands, state, events, reconciliation, resources, extensions, and teardown.",
  },
  "/docs/examples": {
    title: "Embedding Examples — Markora",
    description: "Use practical Markora recipes for framework lifecycles, host-owned persistence, scoped UI, and optional Markdown syntax.",
  },
  "/demo": {
    title: "Core Playground — Markora",
    description: "Try Markora's embedded core editor and optional UI in a realistic host-controlled playground.",
  },
};
