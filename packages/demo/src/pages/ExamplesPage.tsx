import { CodeBlock } from "../components/CodeBlock";
import { DocPageNav } from "../components/DocPageNav";

const examples = [
  {
    title: "Product docs editor",
    summary: "Use the editor for knowledge bases, release notes, and internal documentation where Markdown fidelity matters.",
    snippet: `import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";

const editor = createEditor({
  element,
  markdown: initialDoc,
  ui: createDefaultUi(),
  onChange(saveDraft),
  onChangeMode: "animationFrame",
});`,
  },
  {
    title: "AI draft review surface",
    summary: "Let an LLM generate Markdown drafts, then hand them to users in a clean visual editor before publishing.",
    snippet: `editor.commands.setMarkdown(aiDraft, { emitChange: true });
editor.flushChange();`,
  },
  {
    title: "Toolbar-driven CMS field",
    summary: "Bind editor state into your app shell and expose only the controls your product wants to support.",
    snippet: `if (editor.state.can.setLink()) {
  editor.commands.setLink("https://example.com");
}

const isLinkActive = editor.state.isActive.mark("link");`,
  },
  {
    title: "Shadow DOM host",
    summary: "Mount the editor inside a web component and render the default overlays into that same root.",
    snippet: `const shadowRoot = host.attachShadow({ mode: "open" });
const editorMount = document.createElement("div");
shadowRoot.append(editorMount);

const editor = createEditor({
  element: editorMount,
  ui: createDefaultUi({ portalRoot: shadowRoot }),
});`,
  },
  {
    title: "Custom code block languages",
    summary: "Extend or override the lazy-loaded registry for app-specific fenced code blocks.",
    snippet: `import { createDefaultCodeBlockLanguageRegistry, createEditor } from "markora";

const editor = createEditor({
  element,
  codeBlockLanguages: {
    ...createDefaultCodeBlockLanguageRegistry(),
    custom: async () => [],
  },
});`,
  },
  {
    title: "Source-of-truth Markdown storage",
    summary: "Persist the serialized Markdown output directly so your backend stays plain-text and portable.",
    snippet: `onChange(markdown) {
  debouncedSave({ markdown });
}`,
  },
] as const;

const recipes = [
  {
    heading: "Sync with external state",
    body: "Use `editor.commands.setMarkdown()` when upstream content changes, and call `flushChange()` if you need immediate serialized output after the update.",
  },
  {
    heading: "Observe editor behavior",
    body: "Use `onTransaction` when you want analytics, selection awareness, or app-level reactions without serializing Markdown on every keystroke.",
  },
  {
    heading: "Use optional UI selectively",
    body: "Start with the headless core and add `createDefaultUi()` only where link, image, and table overlays save product time.",
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
      ui: createDefaultUi(),
      onChangeMode: "animationFrame",
      onChange,
    });

    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
  }, []);

  return <div ref={hostRef} />;
}`,
  },
  {
    framework: "Vue",
    summary: "Use onMounted / onBeforeUnmount to manage the editor lifecycle inside a component.",
    snippet: `<script setup lang="ts">
import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { onMounted, onBeforeUnmount, ref, shallowRef } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const hostRef = ref<HTMLElement | null>(null);
const editor = shallowRef<MarkdownEditor | null>(null);

onMounted(() => {
  if (!hostRef.value) return;

  editor.value = createEditor({
    element: hostRef.value,
    markdown: props.modelValue,
    ui: createDefaultUi(),
    onChangeMode: "animationFrame",
    onChange: (md) => emit("update:modelValue", md),
  });
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
      ui: createDefaultUi(),
      onChangeMode: "animationFrame",
      onChange,
    });
  });

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
