import { afterEach, describe, expect, it } from "vitest";
import { DOMSerializer } from "prosemirror-model";
import { createEditor } from "../src/createEditor";
import {
  defaultMarkdownEditorMessages,
  normalizeMarkdownEditorMessages,
  type MarkdownEditorMessageOverrides,
} from "../src/editorMessages";
import { createCompatibilityMarkdownCodec } from "../src/markdownCodec";
import { normalizeMarkdownEditorResources } from "../src/resourcePolicy";

const editors: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

describe("core editor messages", () => {
  it("uses one frozen English default contract", () => {
    expect(normalizeMarkdownEditorMessages(undefined)).toBe(defaultMarkdownEditorMessages);
    expect(Object.isFrozen(defaultMarkdownEditorMessages)).toBe(true);
    expect(Object.isFrozen(defaultMarkdownEditorMessages.opaqueKindLabels)).toBe(true);
  });

  it("copies partial overrides, freezes contexts, and fills omitted values", () => {
    let formatterContext: unknown;
    const opaqueKindLabels = { frontmatter: "Cabecera" };
    const overrides: MarkdownEditorMessageOverrides = {
      imageEmptyAltTextLabel: "Imagen sin texto alternativo",
      imageLoading: "Cargando imagen",
      opaqueKindLabels,
      opaqueSourceLabel(context) {
        formatterContext = context;
        return `Fuente ${context.kindLabel}`;
      },
    };
    const messages = normalizeMarkdownEditorMessages(overrides);
    opaqueKindLabels.frontmatter = "Mutated after normalization";

    expect(messages.imageLoading).toBe("Cargando imagen");
    expect(messages.imageEmptyAltTextLabel).toBe("Imagen sin texto alternativo");
    expect(messages.imageMissingUrl).toBe("Missing image URL");
    expect(messages.opaqueKindLabels.frontmatter).toBe("Cabecera");
    expect(messages.opaqueKindLabels["html-block"]).toBe("HTML block");
    expect(messages.opaqueKindLabels["reference-definition"]).toBe("Link reference definition");
    expect(messages.opaqueSourceLabel(Object.freeze({
      kind: "frontmatter",
      kindLabel: messages.opaqueKindLabels.frontmatter,
    }))).toBe("Fuente Cabecera");
    expect(Object.isFrozen(formatterContext)).toBe(true);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(Object.isFrozen(messages.opaqueKindLabels)).toBe(true);
  });

  it("treats explicit undefined partial values as omitted", () => {
    const messages = normalizeMarkdownEditorMessages({
      imageLoading: undefined,
      opaqueKindLabels: { frontmatter: undefined },
      opaqueSourceLabel: undefined,
    });

    expect(messages.imageLoading).toBe(defaultMarkdownEditorMessages.imageLoading);
    expect(messages.opaqueKindLabels.frontmatter)
      .toBe(defaultMarkdownEditorMessages.opaqueKindLabels.frontmatter);
    expect(messages.opaqueSourceLabel)
      .toBe(defaultMarkdownEditorMessages.opaqueSourceLabel);
  });

  it("rejects malformed, inherited, unknown, blank, and invalid formatter values", () => {
    expect(() => normalizeMarkdownEditorMessages(null as never)).toThrow(/messages must be an object/i);
    expect(() => normalizeMarkdownEditorMessages([] as never)).toThrow(/messages must be an object/i);
    expect(() => normalizeMarkdownEditorMessages(
      Object.create({ imageLoading: "inherited" }) as MarkdownEditorMessageOverrides,
    )).toThrow(/ordinary or null-prototype object/i);
    expect(() => normalizeMarkdownEditorMessages({ unknown: "value" } as never))
      .toThrow(/unknown key "unknown"/i);
    const unknownSymbol = Symbol("unknown");
    expect(() => normalizeMarkdownEditorMessages({ [unknownSymbol]: "value" } as never))
      .toThrow(/unknown key "Symbol\(unknown\)"/i);
    expect(() => normalizeMarkdownEditorMessages({ imageLoading: "  " }))
      .toThrow(/imageLoading.*nonblank string/i);
    expect(() => normalizeMarkdownEditorMessages({ codeBlockEditLanguageLabel: "bad" } as never))
      .toThrow(/codeBlockEditLanguageLabel.*function/i);
    expect(() => normalizeMarkdownEditorMessages({
      opaqueKindLabels: { inherited: "bad" },
    } as never)).toThrow(/unknown key "inherited"/i);

    const messages = normalizeMarkdownEditorMessages({
      opaqueSourceLabel: () => "",
    });
    expect(() => messages.opaqueSourceLabel({
      kind: "frontmatter",
      kindLabel: "Cabecera",
    })).toThrow(/opaqueSourceLabel result.*nonblank string/i);
  });

  it("injects core-owned visible text, accessible names, and schema fallback DOM", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const messages = normalizeMarkdownEditorMessages({
      codeBlockPlainTextLabel: "texto sin formato",
      imageBlockedByPolicy: "Imagen bloqueada por política",
      imageEmptyAltTextLabel: "Imagen sin texto alternativo",
      opaqueEditSource: "Editar fuente",
      opaqueEditSourceLabel: ({ kindLabel }) => `Editar fuente ${kindLabel}`,
      opaqueKindLabels: { "html-block": "Bloque HTML" },
      opaqueSourceLabel: ({ kindLabel }) => `Fuente Markdown ${kindLabel}`,
      taskFallbackLabel: "Tarea sin nombre",
    });
    const editor = createEditor({
      element,
      markdown: [
        "- [ ] &nbsp;",
        "",
        "```",
        "code",
        "```",
        "",
        "![](https://example.com/image.png)",
        "",
        "<section>opaque</section>",
      ].join("\n"),
      messages,
      onEditOpaqueMarkdown() {},
      resources: {
        loadImage: () => null,
      },
    });
    editors.push(editor);

    expect(element.querySelector('[data-mdw-task-control="true"]')?.getAttribute("aria-label"))
      .toBe("Tarea sin nombre");
    expect(element.querySelector(".mdw-code-block-language")?.textContent)
      .toBe("texto sin formato");
    expect(element.querySelector(".mdw-image-status")?.textContent)
      .toContain("Imagen bloqueada por política");
    expect(element.querySelector(".mdw-image img")?.getAttribute("aria-label"))
      .toBe("Imagen sin texto alternativo");
    expect(element.querySelector(".mdw-opaque-kind")?.textContent).toBe("Bloque HTML");
    expect(element.querySelector(".mdw-opaque-block")?.getAttribute("aria-label"))
      .toBe("Fuente Markdown Bloque HTML");
    expect(element.querySelector(".mdw-opaque-edit")?.textContent).toBe("Editar fuente");
    expect(element.querySelector(".mdw-opaque-edit")?.getAttribute("aria-label"))
      .toBe("Editar fuente Bloque HTML");

    const codec = createCompatibilityMarkdownCodec(
      [],
      normalizeMarkdownEditorResources(undefined),
      messages,
    );
    const rawBlock = codec.schema.nodes.raw_block.create({
      kind: "html-block",
      source: "<section>opaque</section>",
    });
    const serialized = DOMSerializer.fromSchema(codec.schema).serializeNode(rawBlock);
    expect((serialized as HTMLElement).getAttribute("aria-label"))
      .toBe("Fuente Markdown Bloque HTML");
  });
});
