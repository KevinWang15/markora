# Markdown conformance fixture notice

`spec-cases.json` contains selected Markdown inputs derived from two official specifications:

- “CommonMark Spec 0.31.2” by John MacFarlane, <https://spec.commonmark.org/0.31.2/>.
- “GitHub Flavored Markdown Spec 0.29-gfm,” based on the CommonMark specification by John MacFarlane, <https://github.github.com/gfm/>.

The specification content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The fixture records the source, version, example URL, classification, and Markora-reviewed canonical output for every selected input. Markora's test harness and package code remain MIT-licensed.

This is a representative characterization suite for Markora's published dialect, not a claim of complete CommonMark or GFM compliance. `supported-normalized`, `security-normalized`, `boundary-characterized`, and `unsupported-characterized` cases must retain both their reviewed output and semantic stability. Each `known-limitation` explicitly declares whether semantic stability remains required or is already known to fail, so an interoperability mismatch does not hide an unrelated regression.

`lexicalGuarantees` mirrors the public fidelity contract. It is empty while Markora promises no byte-for-byte preservation. The harness still exercises its opt-in lexical assertion path, making any future guarantee an explicit fixture and test change.
