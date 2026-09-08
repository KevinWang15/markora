import { appendFileSync, mkdirSync, readFileSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = "ci-results";
const outputPath = join(outputDirectory, "browser-resources.jsonl");
const lowDiskBytes = 2 * 1024 ** 3;

function read(path) {
  try { return readFileSync(path, "utf8").trim(); } catch { return null; }
}

function filesystem(path) {
  try {
    const stats = statfsSync(path);
    return { path, availableBytes: stats.bavail * stats.bsize, freeInodes: stats.ffree };
  } catch (error) { return { path, error: String(error) }; }
}

function diskDetails() {
  // Run only at the beginning/end or on a low-space transition. A periodic du
  // would itself compete with browser I/O. Bound both its runtime and output.
  const result = spawnSync("du", ["-sx", "--block-size=1", "--", tmpdir(),
    "/var/crash", "/var/lib/systemd/coredump", "/var/log", "test-results", "playwright-report"],
  { encoding: "utf8", timeout: 2000, maxBuffer: 16 * 1024 });
  return { output: result.stdout ?? "", errors: result.stderr ?? "", error: result.error?.message ?? null };
}

/** CI-only evidence for transient pressure that has disappeared by job teardown. */
export default class BrowserResourcesReporter {
  timer;
  active = new Map();
  lowDisk = false;
  disabled = false;

  write(record) {
    if (this.disabled) return;
    try {
      appendFileSync(outputPath, JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n");
    } catch (error) {
      // Disk exhaustion must not replace the actual test failure with a reporter
      // failure. Preserve the last observation in the job log if writing fails.
      console.warn("Browser resource report unavailable:", String(error), JSON.stringify(record));
    }
  }

  sample(event = "sample") {
    const filesystems = [filesystem(process.cwd()), filesystem(tmpdir())];
    const lowDisk = filesystems.some(item => item.availableBytes < lowDiskBytes);
    const details = event !== "sample" || (lowDisk && !this.lowDisk) ? diskDetails() : undefined;
    this.write({ event, activeTests: [...this.active.values()], filesystems,
      memory: read("/proc/meminfo"), pressure: {
        cpu: read("/proc/pressure/cpu"), memory: read("/proc/pressure/memory"), io: read("/proc/pressure/io"),
      }, details });
    if (lowDisk && !this.lowDisk) console.warn("Browser runner low disk space:", JSON.stringify({ filesystems, details }));
    this.lowDisk = lowDisk;
  }

  onBegin(config) {
    try { mkdirSync(outputDirectory, { recursive: true }); }
    catch (error) { this.disabled = true; console.warn("Cannot create browser resource report:", String(error)); return; }
    this.write({ event: "environment", corePattern: read("/proc/sys/kernel/core_pattern"),
      coredumpPolicy: read("/etc/systemd/coredump.conf.d/99-markora-ci.conf"),
      workers: config.workers, projects: config.projects.map(project => ({ name: project.name,
        trace: project.use.trace, video: project.use.video })) });
    this.sample("begin");
    this.timer = setInterval(() => this.sample(), 10_000);
    this.timer.unref();
  }

  onTestBegin(test, result) {
    this.active.set(test.id, { title: test.titlePath(), retry: result.retry });
  }

  onTestEnd(test, result) {
    if (result.status !== "passed" && result.status !== "skipped") this.sample("test-failure");
    this.active.delete(test.id);
  }

  onEnd() {
    clearInterval(this.timer);
    if (!this.disabled) this.sample("end");
  }

  onExit() { clearInterval(this.timer); }
}
