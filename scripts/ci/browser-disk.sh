#!/usr/bin/env bash
set -euo pipefail

report_disk_usage() {
  echo "::group::Browser runner disk usage"
  df -h . /tmp
  df -i . /tmp
  # Include temporary browser recordings and the preinstalled SDKs so a full
  # runner can be diagnosed even when Playwright cannot write an artifact.
  for path in test-results playwright-report node_modules /tmp /usr/local/lib/android /usr/share/dotnet /opt/ghc; do
    if [[ -e "$path" ]]; then
      du -sh "$path" 2>/dev/null || true
    fi
  done
  echo "::endgroup::"
}

available_kib() {
  df -Pk . | awk 'NR == 2 { print $4 }'
}

case "${1:-report}" in
  report)
    report_disk_usage
    ;;
  prepare)
    # These fixed SDK paths belong to the disposable Ubuntu hosted image.
    # Never remove them on a developer machine or a self-hosted runner.
    if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != Linux ]]; then
      echo "Disk preparation requires a GitHub-hosted Linux runner." >&2
      exit 1
    fi
    report_disk_usage
    if (( $(available_kib) < 20 * 1024 * 1024 )); then
      echo "Reclaiming unused Android, .NET, and Haskell SDKs for browser tests."
      sudo rm -rf -- /usr/local/lib/android /usr/share/dotnet /opt/ghc
      report_disk_usage
    fi
    if (( $(available_kib) < 10 * 1024 * 1024 )); then
      echo "::error::Less than 10 GiB available for browser tests after runner cleanup."
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [prepare|report]" >&2
    exit 2
    ;;
esac
