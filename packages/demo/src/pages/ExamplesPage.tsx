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
  onChangeMode: "animationFrame",
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
    snippet: `onChange(markdown) {
  debouncedSave({ markdown });
}`,
  },
] as const;

const recipes = [
  {
    heading: "Apply host state intentionally",
    body: "Use `reconcileMarkdown()` for ordinary authoritative snapshots; it maps selection/history and preserves plugin state (overlapping undo entries can become no-ops). Use `resetMarkdown()` only when switching documents or deliberately clearing transient state. `setMarkdown()` is a deprecated reset alias.",
  },
  {
    heading: "Observe editor behavior",
    body: "Subscribe to `state` to refresh command availability and active toolbar state after accepted editor-state transitions without serializing. Use `selection` and `update` for narrower signals, and keep `onTransaction` for integrations that deliberately depend on ProseMirror dispatch attempts.",
  },
  {
    heading: "Update runtime options",
    body: "Use `updateOptions()` to change editable state, placeholder, attributes, accessible naming, or callbacks without rebuilding editor state or emitting a document update.",
  },
  {
    heading: "Lean on the internal dev lab",
    body: "When developing Markora itself, open the demo app's `/__dev` route to load canned fixtures for tables, task lists, quotes, and code blocks.",
  },
] as const;

const frameworkExamples = [
  {
    framework: "React",
    summary: "Mount in a useEffect, destroy on cleanup. Store the editor ref for imperative access.",
    snippet: `import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { useEffect, useRef } from "react";

export function MarkdownField({ value, onChange }: {
  value: string;
  onChange: (md: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const editor = createEditor({
      element: hostRef.current,
      markdown: value,
      ariaLabel: "Markdown field",
      ui: createDefaultUi(),
      onChangeMode: "animationFrame",
      onChange,
    });

    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    editorRef.current?.commands.reconcileMarkdown(value);
  }, [value]);

  return <div ref={hostRef} />;
}`,
  },
  {
    framework: "Vue",
    summary: "Use onMounted / onBeforeUnmount to manage the editor lifecycle inside a component.",
    snippet: `<script setup lang="ts">
import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { onMounted, onBeforeUnmount, ref, shallowRef, watch } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const hostRef = ref<HTMLElement | null>(null);
const editor = shallowRef<MarkdownEditor | null>(null);

onMounted(() => {
  if (!hostRef.value) return;

  editor.value = createEditor({
    element: hostRef.value,
    markdown: props.modelValue,
    ariaLabel: "Markdown field",
    ui: createDefaultUi(),
    onChangeMode: "animationFrame",
    onChange: (md) => emit("update:modelValue", md),
  });
});

watch(() => props.modelValue, (value) => {
  editor.value?.commands.reconcileMarkdown(value);
});

onBeforeUnmount(() => { editor.value?.destroy(); });
</script>

<template>
  <div ref="hostRef" />
</template>`,
  },
  {
    framework: "Svelte",
    summary: "Bind the host element with bind:this and use onMount / onDestroy for the editor lifecycle.",
    snippet: `<script lang="ts">
  import { createEditor, type MarkdownEditor } from "markora";
  import { createDefaultUi } from "markora-ui";
  import { onMount, onDestroy } from "svelte";

  export let value = "";
  export let onChange: (md: string) => void = () => {};

  let hostElement: HTMLElement;
  let editor: MarkdownEditor | null = null;

  onMount(() => {
    editor = createEditor({
      element: hostElement,
      markdown: value,
      ariaLabel: "Markdown field",
      ui: createDefaultUi(),
      onChangeMode: "animationFrame",
      onChange,
    });
  });

  $: if (editor) editor.commands.reconcileMarkdown(value);

  onDestroy(() => { editor?.destroy(); });
</script>

<div bind:this={hostElement}></div>`,
  },
] as const;

export function ExamplesPage() {
  return (
    <div className="doc-stack">
      <section className="panel doc-panel">
        <span className="card-kicker">Examples</span>
        <h2>Patterns for real apps, not just toy demos.</h2>
        <p>
          These examples show where Markora fits best: places where you want a Typora-like writing
          {" "}experience, but still need app-level control over storage, UI, and code-block support.
        </p>
      </section>

      <section className="examples-grid">
        {examples.map((example) => (
          <article key={example.title} className="doc-card example-card">
            <span className="card-kicker">Use case</span>
            <h3>{example.title}</h3>
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
          {" "}create and destroy an editor instance in React, Vue, and Svelte.
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
            <h3>{recipe.heading}</h3>
            <p>{recipe.body}</p>
          </article>
        ))}
      </section>

      <DocPageNav />
    </div>
  );
}
