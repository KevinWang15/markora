import type { Extension } from "@codemirror/state";

export type CodeBlockLanguageSupport = Extension | (() => Extension | Promise<Extension>);
export type CodeBlockLanguageRegistry = Record<string, CodeBlockLanguageSupport>;

type PendingLanguageSubscriber = {
  onResolved: (extension: Extension) => void;
  // Return true when this subscriber is still live and can claim the shared
  // failure. Every live subscriber is notified, but only one reports it.
  onRejected: (error: unknown, reportSharedFailure: boolean) => boolean;
};

type PendingLanguageSupport = {
  status: "pending";
  subscribers: Map<number, PendingLanguageSubscriber>;
};

type ResolvedLanguageSupport = {
  extension: Extension;
  status: "resolved";
};

type CachedLanguageSupport = PendingLanguageSupport | ResolvedLanguageSupport;

export type CodeBlockLanguageSubscription =
  | { status: "missing" }
  | ResolvedLanguageSupport
  | { status: "pending"; unsubscribe: () => void };

export type CodeBlockLanguageSubscriber = PendingLanguageSubscriber;

function lazyModuleLanguage<TModule>(loadModule: () => Promise<TModule>, createExtension: (module: TModule) => Extension) {
  return () => loadModule().then((module) => createExtension(module));
}

function lazyShellLanguage() {
  return () => Promise.all([
    import("@codemirror/language"),
    import("@codemirror/legacy-modes/mode/shell"),
  ]).then(([{ StreamLanguage }, module]) => StreamLanguage.define(module.shell));
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
    bash: lazyShellLanguage(),
    sh: lazyShellLanguage(),
    shell: lazyShellLanguage(),
  };
}

export function createCodeBlockLanguageResolver(languageRegistry?: CodeBlockLanguageRegistry) {
  const registry = {
    ...createDefaultCodeBlockLanguageRegistry(),
    ...languageRegistry,
  };
  const cache = new Map<string, CachedLanguageSupport>();
  let nextSubscriberId = 1;

  function subscribe(
    language: string,
    subscriber: CodeBlockLanguageSubscriber,
  ): CodeBlockLanguageSubscription {
    const normalized = normalizeCodeBlockLanguage(language);

    if (!normalized) {
      return { status: "missing" };
    }

    const cached = cache.get(normalized);

    if (cached) {
      if (cached.status === "resolved") {
        return cached;
      }

      return addPendingSubscriber(cached, subscriber);
    }

    const support = registry[normalized];

    if (!support) {
      return { status: "missing" };
    }

    if (typeof support !== "function") {
      const resolved = { extension: support, status: "resolved" } as const;
      cache.set(normalized, resolved);
      return resolved;
    }

    const loadedSupport = support();

    if (isPromiseLike(loadedSupport)) {
      const pending: PendingLanguageSupport = {
        status: "pending",
        subscribers: new Map(),
      };
      cache.set(normalized, pending);
      const subscription = addPendingSubscriber(pending, subscriber);

      // Observe each shared host promise exactly once. Individual active code
      // blocks live only in the subscriber map and can remove themselves while
      // a loader remains pending, so a host promise cannot retain every editor
      // created by repeated viewport activation.
      void Promise.resolve(loadedSupport).then(
        (extension) => settleResolved(normalized, pending, extension),
        (error: unknown) => settleRejected(normalized, pending, error),
      );
      return subscription;
    }

    const resolved = { extension: loadedSupport, status: "resolved" } as const;
    cache.set(normalized, resolved);
    return resolved;
  }

  function addPendingSubscriber(
    pending: PendingLanguageSupport,
    subscriber: CodeBlockLanguageSubscriber,
  ): Extract<CodeBlockLanguageSubscription, { status: "pending" }> {
    const subscriberId = nextSubscriberId;
    nextSubscriberId += 1;
    pending.subscribers.set(subscriberId, subscriber);
    let subscribed = true;

    return {
      status: "pending",
      unsubscribe() {
        if (!subscribed) {
          return;
        }

        subscribed = false;
        pending.subscribers.delete(subscriberId);
      },
    };
  }

  function settleResolved(
    normalized: string,
    pending: PendingLanguageSupport,
    extension: Extension,
  ) {
    if (cache.get(normalized) !== pending) {
      return;
    }

    cache.set(normalized, { extension, status: "resolved" });
    const subscribers = [...pending.subscribers.values()];
    pending.subscribers.clear();

    for (const subscriber of subscribers) {
      subscriber.onResolved(extension);
    }
  }

  function settleRejected(
    normalized: string,
    pending: PendingLanguageSupport,
    error: unknown,
  ) {
    if (cache.get(normalized) !== pending) {
      return;
    }

    cache.delete(normalized);
    const subscribers = [...pending.subscribers.values()];
    pending.subscribers.clear();
    let sharedFailureReported = false;

    for (const subscriber of subscribers) {
      const current = subscriber.onRejected(error, !sharedFailureReported);

      if (!sharedFailureReported && current) {
        sharedFailureReported = true;
      }
    }
  }

  function getPendingSubscriberCount(language?: string) {
    if (language !== undefined) {
      const cached = cache.get(normalizeCodeBlockLanguage(language));
      return cached?.status === "pending" ? cached.subscribers.size : 0;
    }

    let count = 0;

    for (const cached of cache.values()) {
      if (cached.status === "pending") {
        count += cached.subscribers.size;
      }
    }

    return count;
  }

  return { getPendingSubscriberCount, subscribe };
}

function isPromiseLike(value: Extension | Promise<Extension>): value is Promise<Extension> {
  return (
    typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function"
  );
}
