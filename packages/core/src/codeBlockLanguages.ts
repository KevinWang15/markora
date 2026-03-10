import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

export type CodeBlockLanguageSupport = Extension | (() => Extension | Promise<Extension>);
export type CodeBlockLanguageRegistry = Record<string, CodeBlockLanguageSupport>;

type CachedLanguageSupport = Extension | Promise<Extension>;

function lazyModuleLanguage<TModule>(loadModule: () => Promise<TModule>, createExtension: (module: TModule) => Extension) {
  return () => loadModule().then((module) => createExtension(module));
}

export function normalizeCodeBlockLanguage(language: string) {
  return language.trim().toLowerCase();
}

export function createDefaultCodeBlockLanguageRegistry(): CodeBlockLanguageRegistry {
  return {
    javascript: lazyModuleLanguage(() => import("@codemirror/lang-javascript"), (module) => module.javascript()),
    js: lazyModuleLanguage(() => import("@codemirror/lang-javascript"), (module) => module.javascript()),
    typescript: lazyModuleLanguage(
      () => import("@codemirror/lang-javascript"),
      (module) => module.javascript({ typescript: true }),
    ),
    ts: lazyModuleLanguage(
      () => import("@codemirror/lang-javascript"),
      (module) => module.javascript({ typescript: true }),
    ),
    json: lazyModuleLanguage(() => import("@codemirror/lang-json"), (module) => module.json()),
    css: lazyModuleLanguage(() => import("@codemirror/lang-css"), (module) => module.css()),
    html: lazyModuleLanguage(() => import("@codemirror/lang-html"), (module) => module.html()),
    xml: lazyModuleLanguage(() => import("@codemirror/lang-xml"), (module) => module.xml()),
    markdown: lazyModuleLanguage(() => import("@codemirror/lang-markdown"), (module) => module.markdown()),
    md: lazyModuleLanguage(() => import("@codemirror/lang-markdown"), (module) => module.markdown()),
    python: lazyModuleLanguage(() => import("@codemirror/lang-python"), (module) => module.python()),
    py: lazyModuleLanguage(() => import("@codemirror/lang-python"), (module) => module.python()),
    c: lazyModuleLanguage(() => import("@codemirror/lang-cpp"), (module) => module.cpp()),
    cpp: lazyModuleLanguage(() => import("@codemirror/lang-cpp"), (module) => module.cpp()),
    "c++": lazyModuleLanguage(() => import("@codemirror/lang-cpp"), (module) => module.cpp()),
    java: lazyModuleLanguage(() => import("@codemirror/lang-java"), (module) => module.java()),
    rust: lazyModuleLanguage(() => import("@codemirror/lang-rust"), (module) => module.rust()),
    rs: lazyModuleLanguage(() => import("@codemirror/lang-rust"), (module) => module.rust()),
    bash: lazyModuleLanguage(
      () => import("@codemirror/legacy-modes/mode/shell"),
      (module) => StreamLanguage.define(module.shell),
    ),
    sh: lazyModuleLanguage(
      () => import("@codemirror/legacy-modes/mode/shell"),
      (module) => StreamLanguage.define(module.shell),
    ),
    shell: lazyModuleLanguage(
      () => import("@codemirror/legacy-modes/mode/shell"),
      (module) => StreamLanguage.define(module.shell),
    ),
  };
}

export function createCodeBlockLanguageResolver(languageRegistry?: CodeBlockLanguageRegistry) {
  const registry = {
    ...createDefaultCodeBlockLanguageRegistry(),
    ...languageRegistry,
  };
  const cache = new Map<string, CachedLanguageSupport>();

  function resolve(language: string): CachedLanguageSupport | null {
    const normalized = normalizeCodeBlockLanguage(language);

    if (!normalized) {
      return null;
    }

    const cached = cache.get(normalized);

    if (cached) {
      return cached;
    }

    const support = registry[normalized];

    if (!support) {
      return null;
    }

    if (typeof support !== "function") {
      cache.set(normalized, support);
      return support;
    }

    const loadedSupport = support();

    if (loadedSupport instanceof Promise) {
      const cachedPromise = loadedSupport.then((extension) => {
        cache.set(normalized, extension);
        return extension;
      }).catch((error) => {
        cache.delete(normalized);
        throw error;
      });
      cache.set(normalized, cachedPromise);
      return cachedPromise;
    }

    cache.set(normalized, loadedSupport);
    return loadedSupport;
  }

  return { resolve };
}
