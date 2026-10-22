import { createEditor, type MarkdownEditor } from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { createComponentRegistry, createComponentsExtension } from "markora-extension-components";
import { metricsChart } from "../components/metricsChart";
import type { BrowserLabComponentsApi } from "./protocol";
import coreStyles from "markora/styles.css?inline";
import componentStyles from "markora-extension-components/styles.css?inline";
import demoStyles from "../pages/components.css?inline";

export function mountComponentsLab(container: HTMLElement) {
  let editor: MarkdownEditor | undefined;
  let host: HTMLElement | undefined;
  const destroy = () => {
    editor?.destroy();
    editor = undefined;
    host?.remove();
    host = undefined;
  };
  const api: BrowserLabComponentsApi = {
    mount(root: "iframe" | "shadow", entry: "root" | "minimal") {
      destroy();
      host = document.createElement(root === "iframe" ? "iframe" : "div");
      host.dataset.componentsEmbed = root;
      host.style.cssText = "width: 100%; min-height: 600px; border: 0";
      container.append(host);
      const owner = root === "iframe" ? (host as HTMLIFrameElement).contentDocument! : document;
      const mount = root === "iframe" ? owner.body : host.attachShadow({ mode: "open" });
      const styles = owner.createElement("style");
      styles.textContent = `${coreStyles}\n${componentStyles}\n${demoStyles}`;
      const element = owner.createElement("div");
      mount.append(styles, element);
      const registry = createComponentRegistry([metricsChart]);
      const components = createComponentsExtension({ registry });
      editor = (entry === "root" ? createEditor : createMinimalEditor)({
        element,
        extensions: [components],
        markdown: 'Before\n\n```component:metrics-chart\n{"title":"Embedded CPU","metric":"cpu","window":15,"color":"teal"}\n```\n\nAfter',
      });
    },
    markdown: () => editor!.getMarkdown(),
    undo: () => editor!.commands.undo(),
    reset: () => editor!.commands.resetMarkdown(editor!.getMarkdown()),
    readonly: () => editor!.updateOptions({ editable: false }),
    destroy,
  };
  window.__MARKORA_COMPONENTS_LAB__ = api;
  return () => {
    destroy();
    delete window.__MARKORA_COMPONENTS_LAB__;
  };
}
