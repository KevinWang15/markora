import { CodeBlock } from "../components/CodeBlock";
import { DocPageNav } from "../components/DocPageNav";

const examples = [
  {
    title: "Product docs editor",
    summary: "Use the editor for documentation whose input conforms to Markora's published Markdown dialect.",
    snippet: `import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";

const editor = createEditor({
  element,
  markdown: initialDoc,
  ariaLabel: "Product document",
  ui: createDefaultUi(),
  onChange: saveDraft,
});`,
  },
  {
    title: "AI draft review surface",
    summary: "Constrain or validate generated Markdown against the supported dialect before loading it for visual review.",
    snippet: `// Treat loading a different draft as an intentional hard reset.
editor.commands.resetMarkdown(aiDraft, { emitChange: true });
editor.flushChange();
editor.updateOptions({ editable: false, ariaLabel: "AI draft preview" });`,
  },
  {
    title: "Toolbar-driven CMS field",
    summary: "Bind editor state into your app shell and expose only the controls your product wants to support.",
    snippet: `const makeSectionHeading = () => {
  if (editor.state.can.setHeading(2)) editor.commands.setHeading(2);
};

const render = () => {
  renderToolbar({
    heading2: {
      active: editor.state.isActive.heading(2),
      enabled: editor.state.can.setHeading(2),
    },
    bulletList: {
      active: editor.state.isActive.bulletList(),
      enabled: editor.state.can.toggleBulletList(),
    },
  });
};

// Covers document, selection, stored-mark, and history state changes.
const stopState = editor.subscribe("state", render);
render();

// During host teardown:
stopState();`,
  },
  {
    title: "Shadow DOM host",
    summary: "Mount the editor inside a web component and render the default overlays into that same root.",
    snippet: `const shadowRoot = host.attachShadow({ mode: "open" });
const editorMount = document.createElement("div");
shadowRoot.append(editorMount);

const editor = createEditor({
  element: editorMount,
  ariaLabel: "Shadow-root document",
  ui: createDefaultUi({ portalRoot: shadowRoot }),
});`,
  },
  {
    title: "Opt-in advanced syntax",
    summary: "Compose all seven official packages in source mode, then store the resolved extension manifest with the Markdown.",
    snippet: `import { createEditor } from "markora";
import { createAlertsExtension } from "markora-extension-alerts";
import { createDiagramsExtension } from "markora-extension-diagrams";
import { createFootnotesExtension } from "markora-extension-footnotes";
import { createFrontmatterExtension } from "markora-extension-frontmatter";
import { createHtmlExtension } from "markora-extension-html";
import { createMathExtension } from "markora-extension-math";
import { createTocExtension } from "markora-extension-toc";
import "markora/styles.css";
import "markora-extension-alerts/styles.css";
import "markora-extension-diagrams/styles.css";
import "markora-extension-footnotes/styles.css";
import "markora-extension-frontmatter/styles.css";
import "markora-extension-html/styles.css";
import "markora-extension-math/styles.css";
import "markora-extension-toc/styles.css";

const extensions = [
  createFrontmatterExtension(),
  createFootnotesExtension(),
  createMathExtension(),
  createAlertsExtension(),
  createTocExtension(),
  createHtmlExtension(),
  createDiagramsExtension(),
];

const editor = createEditor({ element, markdown, extensions });

saveDocument({
  markdown: editor.getMarkdown(),
  extensionManifest: editor.extensions.manifest,
});`,
  },
  {
    title: "Custom code block languages",
    summary: "Extend or override the lazy-loaded registry for app-specific fenced code blocks.",
    snippet: `import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element,
  ariaLabel: "Code sample document",
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [],
  },
});`,
  },
  {
    title: "Host-owned image uploads",
    summary: "Route pasted and dropped files through your storage service while Markora keeps completion ordered and undoable.",
    snippet: `const editor = createEditor({
  element,
  resources: {
    images: { referrerPolicy: "no-referrer" },
    assets: {
      allowedMimeTypes: ["image/*"],
      maxFileBytes: 10 * 1024 * 1024,
      maxFiles: 10,
      async upload({ file, reportProgress, signal }) {
        const asset = await mediaStore.upload(file, { reportProgress, signal });
        return { kind: "image", url: asset.url, alt: file.name };
      },
    },
  },
});

editor.subscribe("asset", ({ reason, upload }) => {
  uploadPanel.update(reason, upload);
});`,
  },
  {
    title: "Normalized Markdown storage",
    summary: "Persist Markora's serialized output directly when documents stay within the supported dialect.",
    snippet: `// Default idle delivery already coalesces rapid edits.
const editor = createEditor({
  element,
  onChange(markdown) {
    saveDraft({ markdown });
  },
});

editor.subscribe("update", () => markDocumentDirty());

saveButton.addEventListener("click", () => {
  editor.flushChange();
  exportMarkdown(editor.getMarkdown());
});`,
  },
] as const;

const recipes = [
  {
    heading: "Apply host state intentionally",
    body: "Use `reconcileMarkdown()` for ordinary authoritative snapshots; it maps selection/history and preserves plugin state (overlapping undo entries can become no-ops). Use `resetMarkdown()` only when switching documents or deliberately clearing transient state. `setMarkdown()` is a deprecated reset alias.",
  },
  {
    heading: "Observe editor behavior",
    body: "Subscribe to `state` to refresh command availability and active toolbar state after accepted editor-state transitions without serializing. Use `update` as the cheap dirty signal, default idle `onChange` for coalesced persistence, and `getMarkdown()` only at an explicit synchronous save/export boundary.",
  },
  {
    heading: "Update runtime options",
    body: "Use `updateOptions()` to change editable state, placeholder, attributes, accessible naming, or callbacks without rebuilding editor state or emitting a document update.",
  },
  {
    heading: "Theme and localize each embed",
    body: "Import `markora/themes.css`, set `data-mdw-theme` on the editor host, and pass creation-time `messages` for product copy. Set `lang` and `dir` at the embedding boundary; forced-colors and reduced-motion preferences remain automatic.",
  },
] as const;

const frameworkExamples = [
  {
    framework: "React",
    summary: "Mount once, reconcile controlled values, use cheap update signals, and synchronously flush forms before teardown.",
    snippet: `import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { type FormEvent, useEffect, useRef } from "react";

export function MarkdownField({ value, onChange, onDirty, onSubmit }: {
  value: string;
  onChange: (md: string) => void;
  onDirty: () => void;
  onSubmit: (md: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onDirtyRef = useRef(onDirty);
  onChangeRef.current = onChange;
  onDirtyRef.current = onDirty;

  useEffect(() => {
    if (!hostRef.current) return;

    const editor = createEditor({
      element: hostRef.current,
      markdown: value,
      ariaLabel: "Markdown field",
      ui: createDefaultUi(),
      onChange: (markdown) => onChangeRef.current(markdown),
    });
    const stopUpdates = editor.subscribe("update", () => onDirtyRef.current());

    editorRef.current = editor;
    return () => {
      stopUpdates();
      editor.destroy(); // Flushes the latest pending Markdown first.
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    editorRef.current?.commands.reconcileMarkdown(value);
  }, [value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;
    editor.flushChange();
    onSubmit(editor.getMarkdown());
  }

  return <form onSubmit={submit}><div ref={hostRef} /></form>;
}`,
  },
  {
    framework: "Vue",
    summary: "Use onMounted / onBeforeUnmount, reconcile model updates, and snapshot synchronously on submit.",
    snippet: `<script setup lang="ts">
import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { onMounted, onBeforeUnmount, ref, shallowRef, watch } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  dirty: [];
  submit: [value: string];
  "update:modelValue": [value: string];
}>();

const hostRef = ref<HTMLElement | null>(null);
const editor = shallowRef<MarkdownEditor | null>(null);

onMounted(() => {
  if (!hostRef.value) return;

  editor.value = createEditor({
    element: hostRef.value,
    markdown: props.modelValue,
    ariaLabel: "Markdown field",
    ui: createDefaultUi(),
    onChange: (md) => emit("update:modelValue", md),
  });
  editor.value.subscribe("update", () => emit("dirty"));
});

watch(() => props.modelValue, (value) => {
  editor.value?.commands.reconcileMarkdown(value);
});

function submit() {
  editor.value?.flushChange();
  if (editor.value) emit("submit", editor.value.getMarkdown());
}

onBeforeUnmount(() => { editor.value?.destroy(); }); // Final flush is guaranteed.
</script>

<template>
  <form @submit.prevent="submit"><div ref="hostRef" /></form>
</template>`,
  },
  {
    framework: "Svelte",
    summary: "Bind the host, observe cheap updates, reconcile props, and flush a lazy snapshot on submit.",
    snippet: `<script lang="ts">
  import { createEditor, type MarkdownEditor } from "markora";
  import { createDefaultUi } from "markora-ui";
  import { onMount, onDestroy } from "svelte";

  export let value = "";
  export let onChange: (md: string) => void = () => {};
  export let onDirty: () => void = () => {};
  export let onSubmit: (md: string) => void = () => {};

  let hostElement: HTMLElement;
  let editor: MarkdownEditor | null = null;

  onMount(() => {
    editor = createEditor({
      element: hostElement,
      markdown: value,
      ariaLabel: "Markdown field",
      ui: createDefaultUi(),
      onChange: (markdown) => onChange(markdown),
    });
    editor.subscribe("update", () => onDirty());
  });

  $: if (editor) editor.commands.reconcileMarkdown(value);

  function submit() {
    editor?.flushChange();
    if (editor) onSubmit(editor.getMarkdown());
  }

  onDestroy(() => { editor?.destroy(); }); // Final flush is guaranteed.
</script>

<form on:submit|preventDefault={submit}>
  <div bind:this={hostElement}></div>
</form>`,
  },
] as const;

export function ExamplesPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Examples</span>
        <h1>Patterns for production embeds.</h1>
        <p>
          These examples show where Markora fits best: places where you want a focused visual writing
          {" "}experience while keeping storage, security, resources, syntax, and surrounding UI under host control.
        </p>
      </section>

      <section className="examples-grid">
        {examples.map((example) => (
          <article key={example.title} className="doc-card example-card">
            <span className="card-kicker">Use case</span>
            <h2>{example.title}</h2>
            <p>{example.summary}</p>
            <CodeBlock code={example.snippet} language="ts" />
          </article>
        ))}
      </section>

      <section className="panel doc-panel">
        <span className="card-kicker">Framework integration</span>
        <h2>Mount the editor in any framework lifecycle.</h2>
        <p>
          Markora is framework-agnostic. These snippets show the idiomatic way to
          {" "}create and destroy an editor instance in React, Vue, and Svelte. They leave
          {" "}<code>onChangeMode</code> unset to use the coalesced idle default, keep dirty-state
          {" "}notifications serialization-free, and flush a synchronous snapshot for form submission.
        </p>
      </section>

      <section className="examples-grid">
        {frameworkExamples.map((example) => (
          <article key={example.framework} className="doc-card example-card">
            <span className="card-kicker">{example.framework}</span>
            <h3>{example.framework} integration</h3>
            <p>{example.summary}</p>
            <CodeBlock
              code={example.snippet}
              language={example.framework === "Vue" || example.framework === "Svelte" ? "html" : "ts"}
              title={`${example.framework} component`}
            />
          </article>
        ))}
      </section>

      <section className="docs-grid docs-grid-two">
        {recipes.map((recipe) => (
          <article key={recipe.heading} className="feature-card">
            <h2>{recipe.heading}</h2>
            <p>{recipe.body}</p>
          </article>
        ))}
      </section>

      <DocPageNav />
    </div>
  );
}
