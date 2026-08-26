# Markdown conformance fixture notice

`spec-cases.json` contains selected Markdown inputs derived from two official specifications:

- “CommonMark Spec 0.31.2” by John MacFarlane, <https://spec.commonmark.org/0.31.2/>.
- “GitHub Flavored Markdown Spec 0.29-gfm,” based on the CommonMark specification by John MacFarlane, <https://github.github.com/gfm/>.

The specification content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The fixture records the source, version, example URL, classification, and Markora-reviewed canonical output for every selected input. Markora's test harness and package code remain MIT-licensed.

`commonmark-0.31.2.json` additionally retains the Markdown input and section
metadata for all 652 examples from the attributed CommonMark 0.31.2
`spec.json`. The full audit requires semantic and serializer stability for every
example except a short, explicitly reviewed failure list. This is a robustness
boundary, not a claim that every stable example belongs to Markora's supported
dialect.

This is a representative characterization suite for Markora's published dialect, not a claim of complete CommonMark or GFM compliance. `supported-normalized`, `security-normalized`, `boundary-characterized`, and `unsupported-characterized` cases must retain both their reviewed output and semantic stability. Each `known-limitation` explicitly declares whether semantic stability remains required or is already known to fail, so an interoperability mismatch does not hide an unrelated regression.

`lexicalGuarantees` mirrors the public fidelity contract. It lists only the
bounded exact-source guarantees Markora actually publishes. The harness still
exercises its opt-in lexical assertion path, making any future guarantee an
explicit fixture and test change.
