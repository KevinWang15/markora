# Desktop source typing measurements

Measured in Chromium headless against a production renderer on 2026-09-07 in the development container. Each size uses a fresh page, realistic headings and paragraphs, and 30 CDP insertions. Measurements include CDP dispatch and two animation frames; they are not hardware-independent responsiveness guarantees.

| Size | Before p95 | After p95 | Before open + source | After open + source |
| --- | ---: | ---: | ---: | ---: |
| 100 KB | 49.1 ms | 47.8 ms | 715 ms | 689 ms |
| 500 KB | 105.1 ms | 48.4 ms | 1426 ms | 1547 ms |
| 1000 KB | 139.1 ms | 63.4 ms | 3404 ms | 3800 ms |

The change moves word counts and source outline parsing into a worker. Requests coalesce and obsolete results cannot replace the current outline. Outline navigation is disabled while its positions are stale. Opening large documents still constructs the rich editor before entering source and remains a separate optimization opportunity.

To reproduce, run a production app preview on port 4175, then `node scripts/app-source-benchmark.mjs /tmp/source-results.json`. `MARKORA_BENCHMARK_URL` selects another preview. Run comparisons with the same fixture, browser, machine, and workload.
