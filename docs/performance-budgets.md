# Performance budgets

`performance/budgets.json` is the checked performance contract. The benchmark
uses a production-built consumer installed from freshly packed workspace
tarballs, so package exports, dependency resolution, tree-shaking, CSS, and the
runtime path are measured as consumers receive them.

The runtime harness exercises only current behavior: the root editor, coalesced
idle `onChange` delivery, lazy CodeMirror activation, explicit snapshots, and
clean or dirty teardown. It uses exact 100 KiB, 500 KiB, and 1 MiB representative
Markdown documents and rejects external network requests or browser errors.

## Runtime contract

The checked CI profile uses:

- Chromium in a 1280 by 720 viewport with reduced motion;
- one warmup and five timing samples per document size;
- three fresh-browser memory samples per document size;
- a fresh page for each timing and hot-path scenario;
- a fresh browser process for each memory lifecycle;
- coalesced idle change delivery with a synchronous `flushChange()` boundary;
- nine visible code-block shells to verify the eight-editor activation cap.

Timing budgets cover initial synchronous parse/render, presentation, standalone
codec parse and serialization, trusted-key presentation, snapshot latency, and
dirty teardown. Memory budgets cover tracked heap growth, mounted CodeMirror
instances, DOM nodes, event listeners, documents, and retained resources after
teardown. Warning and failure ceilings are defined per document size.

The idle hot-path probe schedules each trusted key 80 ms after the previous
key's actual page timestamp. This avoids catch-up intervals after a delayed
browser dispatch. Every observed interval must still fall within 75–120 ms;
late input, premature snapshots, and budget overruns continue to fail the run.
Reports record each adjusted target and its dispatch lateness.

## Bundle contract

Bundle reporting builds the full root graph with `markora-ui` and the
`markora/minimal` graph independently from packed packages. The root static
closure must exclude CodeMirror, Lezer, and the active code editor while keeping
them in lazy chunks. The minimal graph must exclude those modules, table editing,
and root-only styles from every chunk.

Raw and gzip JavaScript, CSS, lazy output, total output, and static module counts
are checked against `performance/budgets.json`. Optional advanced-syntax packages
are also packed and measured without bundling host renderer engines.

The 0.1.0 release-preparation check measures 201 root static modules. The root
module-count failure ceiling increases from 200 to 205, leaving four modules
of headroom. Its warning threshold remains 197; all byte-size, other graph,
runtime, and memory budgets remain unchanged.

The phase-1 shared atom view adds one dependency-free core module, exported
through `markora/extension-api`, and common frame/selection styles to both core
stylesheets. The packed root graph measures 202 static modules and 43,817 raw /
6,743 gzip CSS bytes, within its existing failure ceilings. The packed minimal
graph measures 152 modules and 11,871 raw / 2,534 gzip CSS bytes. Its module
ceiling increases by exactly one to 152; its CSS ceilings become 12,000 raw /
2,600 gzip bytes. Warning thresholds and all JavaScript byte, optional-extension,
runtime, and memory budgets remain unchanged. The shared module has no runtime
imports and does not pull root-only features into minimal.

After the remaining atom migrations, the root and minimal module counts remain
202 and 152. Their CSS measures 43,616 raw / 6,752 gzip and 11,670 raw / 2,540
gzip bytes respectively. The combined seven-extension graph shrinks by 672 raw
JavaScript bytes and 1,190 raw CSS bytes relative to phase 1.

The standalone math graph now uses the shared helper rather than tree-shaking
it away: JavaScript grows from 148,026 raw / 38,291 gzip to 152,142 raw / 39,726
gzip bytes. Its initial and total JavaScript failure ceilings become 155,000
raw / 40,500 gzip, leaving about 2% headroom. Math's warning thresholds, CSS,
module-count and lazy-output limits, and every other graph's limits stay
unchanged. No runtime or memory budget is relaxed.

The 2026-08-31 root-bundle review measured 41,949 raw / 6,221 gzip CSS bytes
and 181 static modules after the theme, localization, and table-control work.
The review also replaced the `@lucide/icons` barrel import, which made the
consumer traverse 1,958 static modules, with the package's per-icon entry
points. The root failure ceilings retain approximately 5–7% headroom over the
reviewed 181-module / 41,949-byte graph; the older warning thresholds remain in
place so further growth stays visible in CI.

The context-menu bundle review ([packed report from CI](https://github.com/KevinWang15/markora/actions/runs/34149295604))
measured the following production-minified consumer at `1817089`:

| Full editor + default UI | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Initial JavaScript | 1,024,466 | 280,195 |
| Lazy JavaScript | 1,086,850 | 345,467 |
| Total JavaScript | 2,111,316 | 625,662 |
| CSS | 44,903 | 6,694 |

The graph has 187 static modules. Context-menu composition, targeting,
clipboard transport, accessible interaction, and the extracted overlay environment
add six modules to the reviewed 181-module default-UI graph. This is an
intentional feature cost in the optional UI consumer; it does not move default
UI or active CodeMirror into the headless/minimal entry. The new root initial,
total, and CSS failure ceilings retain approximately 5–7% headroom over these
measurements. Warning thresholds, lazy-chunk ceilings, static-module ceilings,
minimal-editor limits, and all runtime/memory contracts remain unchanged.

## Commands

Run the same checked entry point used by CI:

```sh
pnpm perf:ci
```

For a local report without enforcing CI sample counts and ceilings:

```sh
pnpm perf:benchmark --profile quick
```

Reports are written under the ignored `performance-results/` directory and
include environment, fixture, package, tarball, and harness provenance. Review
raw samples and variance before changing a budget.

## Runtime consolidation and buffered serialization review

The shared-runtime refactor extracts nine additional root modules and eight
minimal modules without adding third-party dependencies. The reviewed graphs
contain 196 and 148 static modules. Their failure ceilings move by exactly those
extraction deltas (190 → 199 and 142 → 150). All JavaScript/CSS byte failure
ceilings and dependency-exclusion invariants remain unchanged.

The measured full editor/default UI initial output is 1,026,935 raw / 281,396 gzip
bytes; minimal is 794,333 raw / 222,605 gzip bytes. Root CSS remains 44,903 raw /
6,694 gzip; minimal CSS remains 11,639 raw / 2,411 gzip. Root/minimal warning
thresholds now reflect these reviewed baselines, with smaller headroom than the
failure ceilings, instead of warning continuously against obsolete feature sets.

CPU profiling of the representative 1 MiB document on the local Xeon E5-2650 v4,
Node 24.18 host identified repeated output-string flattening in the serializer's
line-ending checks. A chunked writer retains a two-character suffix and preserves
ProseMirror's output semantics, including custom serializer reads/writes. In the
focused CPU-profiled diagnostic, five warmed serializations changed from
3,885–3,966 ms to 159–226 ms. This is a codec measurement, not an end-to-end browser
latency claim. `pnpm perf:serialization` records fixture sizes, samples, environment
and output hashes; the packed Chromium benchmarks validate product behavior.

The Chromium report at `80d064b` measured a 1 MiB serialization maximum of 115.195 ms,
mounting maximum of 556.86 ms, and idle snapshot latency maximum of 425.73 ms. All
memory checks passed. That run failed one parse sample (329.025 ms against 280 ms;
the other four were 173.67–191.165 ms). Follow-up normalization now reuses immutable
nodes and avoids rebuilding unchanged task-list/whitespace subtrees and attributes.
The parse ceiling is unchanged. To protect the serialization improvement, the
512 KiB and 1 MiB serialization failure ceilings are reduced to 250 and 500 ms,
and the 1 MiB idle snapshot ceiling to 1,000 ms.

## In-place math editing review

The math extension now includes the native TeX input, syntax mirror, focus styling,
responsive sizing and forced-colors fallback formerly supplied by a host dialog.
The packed stylesheet measures 8,158 raw / 1,858 gzip bytes. Its CSS warning/failure
ceilings become 8,500/9,200 raw and 1,950/2,100 gzip bytes, retaining approximately
12–13% failure headroom for this new feature. This changes only the standalone
math CSS allowance. JavaScript, combined-extension CSS, dependency exclusions,
and runtime/memory failure ceilings remain unchanged. No CodeMirror, React or
rendering-engine dependency was added to math's source editor.

## Parser allocation review

CPU profiling after the interaction audit found avoidable allocation in ordinary
Markdown parsing. Opaque inline source hydration now skips paragraphs without
opaque tokens and uses direct offsets for LF-only source; CR and CRLF still use
an exact offset map. The source-fidelity tests cover repeated inline spans and
Unicode prefixes with all three line-ending forms. Task normalization stops at
text blocks, and whitespace normalization analyzes crossing mark runs only when
marked text actually has whitespace at an edge. The checked fixtures and all
runtime, memory and bundle budgets remain unchanged.

## September 2026 CI timing calibration

The September 8 review compared the raw five-sample timing series from two
successful runs ([`6a79f7c`](https://github.com/KevinWang15/markora/actions/runs/34204208678),
[`65b32cb`](https://github.com/KevinWang15/markora/actions/runs/34207710744)) with
the navigation refactor runs
([`42a3636`](https://github.com/KevinWang15/markora/actions/runs/34216164885),
[`9649def`](https://github.com/KevinWang15/markora/actions/runs/34217399710)).
These used the same fixtures, sampling contracts, Chromium 149.0.7827.55,
Node 24.20.0 and Ubuntu 24.04 runner label. The reported CPUs were AMD EPYC 7763
and 9V74 with two logical CPUs exposed to the runner.

Only three maximum-time failure ceilings change:

| Metric | Reviewed samples (ms, collection order) | Old ceiling | New ceiling |
| --- | --- | ---: | ---: |
| 100 KiB codec parse, `42a3636` | 42.955, 38.135, 38.640, 42.135, 61.110 | 50 ms | 65 ms |
| 1 MiB codec parse, `42a3636` | 178.090, 180.160, 182.050, 330.860, 193.885 | 280 ms | 350 ms |
| 500 KiB advanced-syntax teardown, `9649def` | 25.9, 68.2, 27.9, 26.7, 61.4 | 50 ms | 75 ms |

The two successful baselines had parse maxima of 41.090–44.765 ms at 100 KiB
and 191.015–194.305 ms at 1 MiB. The subsequent `9649def` run, which changes
only browser tests relative to `42a3636`, measured maxima of 41.825 and
182.470 ms. Advanced-syntax teardown already varied from 25.6 to 48.0 ms in
the `6a79f7c` baseline. The later samples support a bounded allowance for
occasional slow measurements rather than establishing a sustained parse
slowdown. They do not establish the cause of each spike.

The new ceilings leave approximately 6–10% headroom above the reviewed failing
maxima. All samples still count: the gate uses the maximum, with the existing
coefficient-of-variation failure limit of 0.6. Warning levels stay at 20, 190 and
35 ms respectively, so slower results remain visible. Input-latency, bundle,
memory, retained-resource, renderer-concurrency and editor-count limits are
unchanged. Slower results from the local Xeon E5-2650 v4 host are diagnostic;
they were not used to raise this CI runner contract's other limits.


## Harness maintenance

Packed-consumer source and API fixtures live in `scripts/pack-smoke-consumer/`.
The packing harness copies them into its isolated temporary application; their
imports still resolve against the freshly unpacked tarballs. Only the temporary
consumer's package configuration and local jsdom module URL are generated.
Every fixture is hashed into the bundle report's harness provenance.

Core and advanced-syntax benchmarks share record summarization and configured
statistic validation in `scripts/performance/`. These helpers reject missing or
non-finite measurements. Fixture sizes, sampling, warning/failure thresholds,
variance checks, runtime assertions and package-isolation checks are unchanged.


## Shared scheduler and editor disposal review

The September 8 cleanup adds one extension-API module, `renderScheduler`, shared
by math, diagrams and HTML. The packed root and minimal consumer graphs contain
200 and 151 static modules, so their count ceilings increase by exactly one.
All-seven has 216 modules and stays within its existing 222-module ceiling.

The minimal JavaScript measures 225,287 gzip bytes, 287 bytes (0.13%) above the
previous reviewed 225,000-byte output. Its initial/total gzip ceilings become
228,000 bytes, leaving 1.2% headroom over the new measurement. This accommodates
the shared disposal/error-handling implementation without requiring unrelated
code-size edits to land an architectural refactor. Warnings stay unchanged.
The root/all-seven byte budgets, minimal raw JavaScript and CSS budgets, renderer
engine exclusions, lazy-loading contracts, and every runtime/memory limit stay
unchanged. The packed report includes hashes for all extracted consumer fixtures.


### Follow-up timing samples

The [cleanup verification run](https://github.com/KevinWang15/markora/actions/runs/34226777429)
passed its bundle and retained-resource checks but encountered two small timing
overruns across two attempts on unchanged code. Chromium, Node, fixture sizes,
sampling and harness contracts match the earlier calibration.

| Metric | Attempt / CPU | Samples in collection order (ms) | Old → new failure ceiling |
| --- | --- | --- | --- |
| 1 MiB advanced-syntax ordinary edit | 1 / EPYC 7763 | 182.5, 107.7, 108.5, 124.3, 173.7 | 180 → 200 ms |
| 100 KiB dirty teardown | 2 / EPYC 9V74 | 53.120, 31.930, 32.760, 33.445, 32.800 | 50 → 60 ms |

The ordinary-edit baseline before this cleanup (`6a79f7c`) already measured
176.3, 100.1, 165.4, 178.3 and 174.2 ms. The dirty-teardown run exceeded its
ceiling in only one sample; the other four stayed between 31.9 and 33.5 ms.
This supports modest headroom above the reviewed slow samples, without proving
the cause of each spike. Warning ceilings remain 90 and 35 ms, and maxima still
include every sample. These two changes leave approximately 10% and 13% headroom
above the failing maxima. All other timing, variance and resource limits stay
unchanged. The second attempt stopped at the core runtime gate, so it provides
no second advanced-syntax measurement.


### Cross-run timing headroom

A [third measurement](https://github.com/KevinWang15/markora/actions/runs/34229034256)
on identical product code passed the adjusted teardown gate but recorded
100 KiB initial synchronous rendering at 128.270, 125.255, 126.035, 216.115 and
129.440 ms. One sample exceeded the 200 ms ceiling. This was again an EPYC 7763,
Chromium 149.0.7827.55 / Node 24.20.0 runner. It stopped at the core runtime gate.

Reviewing all available timing samples from these three measurements together
found two other ceilings with less than roughly 10% headroom. The following
changes give each of these metrics at least 10% headroom over its observed
maximum, while leaving already adequate ceilings in place:

| Metric | Reviewed maximum | Failure ceiling | Headroom |
| --- | ---: | ---: | ---: |
| 100 KiB initial synchronous render | 216.115 ms | 200 → 250 ms | 15.7% |
| 100 KiB codec parse | 61.100 ms | 65 → 70 ms | 14.6% |
| 1 MiB codec parse | 332.755 ms | 350 → 375 ms | 12.7% |

This is a review of slow samples across the same checked fixtures, not a claim
that the refactor improved execution speed or a diagnosis of individual pauses.
Every sample, warning ceiling, variance gate, resource invariant and other
failure ceiling is retained. Future increases still require a fresh review;
these limits do not adjust automatically from a failing run.


### Median and maximum editing guards

The [next complete measurement](https://github.com/KevinWang15/markora/actions/runs/34230194455)
passed all core-runtime and retained-resource gates. Its 1 MiB advanced-syntax
ordinary-edit samples were 207.9, 106.8, 117.7, 113.2 and 104.8 ms: one sample
exceeded 200 ms, with a median of 113.2 ms. The previous cleanup median was
124.3 ms, and pre-cleanup medians at `65b32cb` and `6a79f7c` were 101.2 and
174.2 ms respectively on the same reported EPYC 7763 CPU model.

This metric now has two independently enforced limits: a 250 ms maximum
(20% headroom over 207.9 ms), and a 180 ms median. The original 180 ms boundary
therefore still rejects a sustained slowdown even when every sample is below
the new maximum. Both warning ceilings remain 90 ms. The report retains all
samples, the primary timing label and its variance gate, and adds a `.median`
evaluation. Other metrics remain unchanged.

Optional `additionalStatistics` entries in a metric budget define independent
warning/failure pairs for already collected summary statistics. Both runtime
harnesses use the same evaluator; missing/non-finite statistics and malformed
thresholds fail validation. This adds no sampling, changes no measurement code,
and does not discard or automatically retry slow samples.

## HTML identity and NodeView refresh cost

Follow-up CPU profiling identified avoidable work in the 1 MiB ordinary-edit
probe: the HTML plugin refreshed every NodeView, resolving each position by
searching its siblings, and its identity index separately called `nodeAt` for
each HTML occurrence. In one local profile, HTML refresh accounted for about
100 ms of the 172 ms synchronous edit. Repeating sibling searches for many
atoms makes that part of the update quadratic in a wide document.

The identity index now validates mapped occurrences during one document walk
and retains a NodeView revision when the same HTML node objects merely move.
Ordinary typing still refreshes UI state but skips occurrence adoption and its
position searches. Replacements, changed HTML and hard resets invalidate that
revision; equal-source replacements continue to cancel stale render generations.
Public source snapshots and occurrence identities keep their previous contract.

Three local diagnostic samples of the same packed, minified all-seven consumer
were 172.2, 160.0 and 195.6 ms before, and 49.3, 50.6 and 50.4 ms after. These
used source maps and Chromium's CPU profiler around `ordinaryEdit`, so they are
diagnostic comparisons, not a replacement CI baseline. No timing thresholds,
sample counts, measurement code or resource gates changed for this optimization.
Regression tests bound position lookups during a 512-atom edit and check that
moving two identical HTML atoms preserves their renderer generations while an
equal replacement invalidates only the replaced occurrence.
