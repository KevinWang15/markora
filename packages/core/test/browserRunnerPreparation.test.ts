// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const linuxTest = it.runIf(process.platform === "linux");

function prepare(environment: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "markora-runner-preparation-"));
  try {
    const log = join(directory, "sudo.log");
    const policy = join(directory, "policy.conf");
    // Privileged commands are intercepted. This test never changes the host.
    writeFileSync(join(directory, "sudo"), `#!/bin/sh
printf '%s\\n' "$*" >> "$MARKORA_PREPARE_TEST_LOG"
if [ "$MARKORA_PREPARE_TEST_DENY" = 1 ]; then exit 9; fi
if [ "$1" = tee ]; then cat > "$MARKORA_PREPARE_TEST_POLICY"; fi
`, { mode: 0o755 });
    writeFileSync(join(directory, "du"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(directory, "df"), "#!/bin/sh\nprintf 'Filesystem Blocks Used Available Capacity Mounted\\nfake 50000000 10000000 40000000 20%% /\\n'\n", { mode: 0o755 });
    const result = spawnSync("bash", [fileURLToPath(new URL("../../../scripts/ci/browser-disk.sh", import.meta.url)), "prepare"], {
      encoding: "utf8", timeout: 5_000, env: { ...process.env,
        GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
        PATH: directory + ":" + process.env.PATH,
        MARKORA_PREPARE_TEST_LOG: log, MARKORA_PREPARE_TEST_POLICY: policy, ...environment,
      },
    });
    return { ...result, commands: existsSync(log) ? readFileSync(log, "utf8") : "",
      policy: existsSync(policy) ? readFileSync(policy, "utf8") : null };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const unsupportedHosts: Array<Record<string, string>> = [
  { GITHUB_ACTIONS: "" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { RUNNER_OS: "Windows" },
];
for (const environment of unsupportedHosts) {
  linuxTest(`rejects runner preparation outside its authorized host: ${JSON.stringify(environment)}`, () => {
    const result = prepare(environment);
    expect(result.status).toBe(1);
    expect(result.commands).toBe("");
    expect(result.policy).toBeNull();
  });
}

linuxTest("disables memory-dump processing even when the runner has ample free disk", () => {
  const result = prepare({});
  expect(result.status, result.stderr).toBe(0);
  expect(result.policy).toBe("[Coredump]\nStorage=none\nProcessSizeMax=0\n");
  expect(result.commands).toContain("tee /etc/systemd/coredump.conf.d/99-markora-ci.conf");
  expect(result.commands).not.toContain("rm -rf");
});

linuxTest("fails preparation when the crash-dump policy cannot be installed", () => {
  const result = prepare({ MARKORA_PREPARE_TEST_DENY: "1" });
  expect(result.status).toBe(9);
  expect(result.policy).toBeNull();
});
