import {
  NodeSelection, Plugin, closeHistory, defineMarkdownEditorExtension,
  type DOMOutputSpec, type EditorState, type MarkdownEditorExtensionRuntime, type Node,
} from "markora/extension-api";
import { normalizeMessages, type ComponentMessages } from "./messages";
import { buildComponentIdentities, collectChangedComponents, componentIdentityKey, mapComponentIdentities } from "./identity";
import { createComponentNodeView, type ComponentNodeView } from "./nodeView";
import { componentMarkdown, componentNamePattern, parseSource } from "./props";
import { readRegistry, serializeProps, validateProps } from "./registry";
import type {
  ComponentDefinition, ComponentReadonly, ComponentRegistry, ComponentSnapshot, ComponentsCommands, ComponentsState,
} from "./types";

export { defineComponent, createComponentRegistry } from "./registry";
export { defaultComponentMessages } from "./messages";
export type { ComponentMessages } from "./messages";
export type * from "./types";

export type ComponentsExtensionOptions = Readonly<{
  registry: ComponentRegistry;
  messages?: Partial<ComponentMessages>;
}>;

const nodeName = "custom_component";

function snapshot(node: Node, position: number): ComponentSnapshot {
  return Object.freeze({ name: node.attrs.name, source: node.attrs.source, position });
}

function findComponent(state: EditorState, position?: number) {
  const target = position ?? (state.selection instanceof NodeSelection ? state.selection.from : undefined);
  if (target === undefined || !Number.isInteger(target) || target < 0 || target >= state.doc.content.size) return null;
  const node = state.doc.nodeAt(target);
  return node?.type.name === nodeName ? { node, position: target } : null;
}

function validAttributes(attrs: Record<string, unknown>) {
  return typeof attrs.name === "string" && attrs.name.length <= 100 && componentNamePattern.test(attrs.name)
    && typeof attrs.source === "string" && !/[\r\u0000]/.test(attrs.source);
}

export function createComponentsExtension(options: ComponentsExtensionOptions) {
  const registry = options.registry;
  const registryState = readRegistry(registry);
  const messages = normalizeMessages(options.messages);
  return defineMarkdownEditorExtension({
    name: "markora-extension-components",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.5.0", markora: "^0.1.0" },
    schema: {
      nodes: [{
        name: nodeName,
        spec: {
          group: "block", atom: true, isolating: true, defining: true, selectable: true,
          attrs: { name: {}, source: {} },
          leafText: node => componentMarkdown(node.attrs.name, node.attrs.source),
          toDOM: node => ["div", {
            "data-mdw-component": node.attrs.name, "data-mdw-component-source": node.attrs.source,
          }, ["pre", componentMarkdown(node.attrs.name, node.attrs.source)]] as DOMOutputSpec,
          parseDOM: [{
            tag: "div[data-mdw-component]",
            getAttrs: dom => {
              const attrs = { name: dom.getAttribute("data-mdw-component"), source: dom.getAttribute("data-mdw-component-source") };
              return validAttributes(attrs) ? attrs : false;
            },
          }],
        },
      }],
      managedBlocks: [nodeName],
    },
    markdown: {
      tokenizerRules: [{
        id: "components", phase: "core", after: ["@markora/foundation/core/block"],
        createRule: ({ token }) => state => {
          for (const current of state.tokens) {
            if (current.type !== "fence") continue;
            const match = /^component:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(current.info.trim());
            if (match && match[1].length <= 100) current.type = token("component");
          }
        },
      }],
      parserTokens: {
        component: {
          node: nodeName, noCloseToken: true,
          getAttrs: token => ({ name: token.info.trim().slice("component:".length), source: token.content.replace(/\n$/, "") }),
        },
      },
      serializer: {
        nodes: {
          [nodeName]: (state, node) => {
            if (!validAttributes(node.attrs)) throw new TypeError("Invalid component node attributes.");
            state.text(componentMarkdown(node.attrs.name, node.attrs.source), false);
            state.closeBlock(node);
          },
        },
      },
    },
    createRuntime({ schema, getState, runCommand, dispatch, lifecycle, reportError }) {
      const views = new Set<ComponentNodeView>();
      const refresh = (name: string) => {
        for (const view of [...views]) {
          if (view.registeredName() === name) view.refresh();
        }
      };
      registryState.listeners.add(refresh);
      lifecycle.addCleanup(() => registryState.listeners.delete(refresh));
      const commands: ComponentsCommands = {
        insert: (definition, props) => runCommand((state, dispatch, view) => {
          if (view?.composing || !registry.has(definition)) return false;
          const source = serializeProps(definition, props);
          if (getState() !== state || !registry.has(definition) || !view?.editable) return false;
          const node = schema.nodes[nodeName].create({ name: definition.name, source });
          // A selected block (such as the component just inserted) is kept: the new component goes
          // right after it, so consecutive inserts add components instead of replacing them.
          const selected = state.selection instanceof NodeSelection && state.selection.node.isBlock ? state.selection : null;
          const transaction = selected ? state.tr.insert(selected.to, node) : state.tr.replaceSelectionWith(node);
          if (transaction.doc.eq(state.doc)) return false;
          const position = [...collectChangedComponents(transaction)].find(([, candidate]) => candidate === node)?.[0];
          if (position === undefined) return false;
          transaction.setSelection(NodeSelection.create(transaction.doc, position));
          dispatch?.(closeHistory(transaction.scrollIntoView()));
          return true;
        }),
        update: (definition, props, position) => runCommand((state, dispatch, view) => {
          const target = findComponent(state, position);
          if (view?.composing) return false;
          if (!registry.has(definition) || target?.node.attrs.name !== definition.name) return false;
          const source = serializeProps(definition, props);
          if (getState() !== state || !registry.has(definition) || !view?.editable || target.node.attrs.source === source) return false;
          dispatch?.(closeHistory(state.tr.setNodeMarkup(target.position, undefined, { ...target.node.attrs, source })));
          return true;
        }),
        updateSource: (source, position) => {
          if (typeof source !== "string") throw new TypeError("Component source must be a string.");
          const normalized = source.replace(/\r\n?/g, "\n");
          return runCommand((state, dispatch, view) => {
            const target = findComponent(state, position);
            if (!target || view?.composing) return false;
            const props = parseSource(normalized);
            const definition = registry.get(target.node.attrs.name);
            if (definition) validateProps(definition, props);
            if (getState() !== state || registry.get(target.node.attrs.name) !== definition || !view?.editable) return false;
            if (target.node.attrs.source === normalized) return false;
            dispatch?.(closeHistory(state.tr.setNodeMarkup(target.position, undefined, { ...target.node.attrs, source: normalized })));
            return true;
          });
        },
        edit: position => {
          const target = findComponent(getState(), position);
          if (!target) return false;
          return [...views].find(view => view.position() === target.position)?.edit() ?? false;
        },
        remove: position => runCommand((state, dispatch, view) => {
          const target = findComponent(state, position);
          if (!target || view?.composing) return false;
          dispatch?.(closeHistory(state.tr.delete(target.position, target.position + target.node.nodeSize).scrollIntoView()));
          return true;
        }),
      };
      const state: ComponentsState = {
        getNodes: () => {
          const index = componentIdentityKey.getState(getState());
          return Object.freeze([...index ?? []].map(([position, { node }]) => snapshot(node, position)));
        },
        getSelected: () => {
          const selected = findComponent(getState());
          return selected ? snapshot(selected.node, selected.position) : null;
        },
        getProps: <TProps extends object>(definition: ComponentDefinition<TProps>, position?: number): ComponentReadonly<TProps> | null => {
          const target = findComponent(getState(), position);
          if (!registry.has(definition) || target?.node.attrs.name !== definition.name) return null;
          try {
            return validateProps(definition, parseSource(target.node.attrs.source)) as ComponentReadonly<TProps>;
          } catch { return null; }
        },
      };
      return {
        commands, state,
        nodeViews: [{
          id: "component", node: nodeName,
          create: () => (node, view, getPos) => {
            const { controller: component, nodeView } = createComponentNodeView(node, view, getPos, registry, messages, dispatch, reportError, controller => { views.delete(controller); });
            views.add(component);
            component.refresh();
            return nodeView;
          },
        }],
        plugins: [{
          id: "components",
          create: () => new Plugin({
            key: componentIdentityKey,
            state: {
              init: (_configuration, state) => buildComponentIdentities(state.doc),
              apply: (transaction, previous) => mapComponentIdentities(transaction, previous),
            },
            filterTransaction: transaction => {
              if (!transaction.docChanged) return true;
              return [...collectChangedComponents(transaction).values()].every(node => validAttributes(node.attrs));
            },
            view: () => {
              const sync = () => { for (const view of views) view.syncEditable(); };
              sync();
              return { update: sync };
            },
          }),
        }],
      } satisfies MarkdownEditorExtensionRuntime<undefined, ComponentsCommands, ComponentsState>;
    },
  });
}

export type ComponentsExtension = ReturnType<typeof createComponentsExtension>;
