# CI behavior checks and diagnostics

The browser matrix uses one worker per engine. Chromium-only scenarios use
`chromiumTest` from `tests/browser/fixtures.ts`: its automatic fixture depends
only on `browserName`, so Firefox/WebKit exclusions happen before page or
context creation. A body-level `test.skip` is too late for that purpose.
The fixture-order regression in `browserSupport.test.ts` runs all three engine
projects with a page fixture that throws if an excluded engine reaches it.
Existing browser coverage and exclusions are unchanged.

CI captures screenshots on the first failure, and traces/videos on the first
retry. Local runs retain their first-failure recordings because local retries
are disabled. Recording every passing test and then discarding its recording
adds unnecessary browser and disk work; the first-retry policy follows
[Playwright's configuration guidance](https://playwright.dev/docs/test-use-options#recording-options).
Browser-lab diagnostics also attach when initial navigation or readiness fails.

The required and full browser jobs upload `ci-results/browser-resources.jsonl`
with their usual artifacts. It records active tests, available disk/inodes,
Linux memory and CPU/memory/I/O pressure every ten seconds. Directory sizes
are inspected only at startup, completion, failure, or a transition below
2 GiB available, with a two-second limit on the inspection. Diagnostics never
delete files or convert a failing test into a passing one.

This addresses an evidence gap in [run 34232157644](https://github.com/KevinWang15/markora/actions/runs/34232157644):
WebKit started with 29 GiB available, reported zero during the run, and finished
with 23 GiB. The startup failures recovered on retry, including one Chromium-only
case that should have skipped before page creation. The old start/end disk
reports did not establish what consumed the transient space. The new report
includes temporary recordings and crash-report directories so a recurrence can
be investigated without assuming that cleanup of installed SDKs will solve it.

The [instrumented follow-up](https://github.com/KevinWang15/markora/actions/runs/34241754563)
still encountered pressure: GitHub reported 5 MiB available, the ten-second
sampler observed 203 MiB, and two different WebKit cases needed retries. The
runner used `systemd-coredump`, with multiple active coredump service directories
during the spikes; stored dumps grew from zero to 156 MiB. Temporary core images
are not represented by the final compressed dump sizes or a later `du` result.

Preparation now sets `Storage=none` and `ProcessSizeMax=0` in a systemd drop-in,
following [systemd's documented way to disable costly dump processing](https://www.freedesktop.org/software/systemd/man/250/systemd-coredump.socket.html#Disabling%20coredump%20processing).
This is guarded to run only on disposable GitHub-hosted Linux machines. It
preserves journal crash metadata, test failures, retry traces and screenshots;
WebKit additionally logs native browser stderr with `DEBUG=pw:browser`. The
resource report records the installed policy so subsequent runs can verify it.
