# Extension RFC prototype

This private workspace package is an executable design fixture for EE-009. It
tests the proposed extension composition contract before the production kernel
exists.

It is deliberately not a Markora extension package:

- it has no package entry point or exports;
- all contract types and helpers live under `test/support`;
- it imports only public Markdown-it and ProseMirror APIs; and
- it must be deleted or migrated onto the real public kernel during EE-010.

The fixture composes a fenced callout block and an inline highlight mark, then
checks schema and Markdown composition, stable tokenizer anchors, precedence
independent of registration order, compiler-qualified local token IDs, per-editor
runtime/storage, state-attached host command handles, fixed
input-rule/plugin/keymap lanes, first-true key chains, and ownership conflicts.
A type-only fixture checks branded heterogeneous definition arrays, inferred
command/state/storage handles, the no-storage overload, and structural-impostor
rejection. Passing these tests validates the RFC shape, not support for loading
the prototype through today's `createEditor` API.
