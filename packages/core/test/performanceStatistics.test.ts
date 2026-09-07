import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateBudget,
  reportBudgetEvaluations,
} from "../../../scripts/performance/budget-evaluator.mjs";
import { summarizeSamples } from "../../../scripts/performance/statistics.mjs";

describe("performance statistics", () => {
  it("retains every sample and reports nearest-rank variance summaries", () => {
    expect(summarizeSamples([1, 2, 3, 4, 100])).toEqual({
      coefficientOfVariation: 1.773,
      count: 5,
      maximum: 100,
      mean: 22,
      median: 3,
      medianAbsoluteDeviation: 1,
      minimum: 1,
      p90: 100,
      p95: 100,
      standardDeviation: 39.013,
    });
  });

  it("rejects missing and non-finite samples", () => {
    expect(() => summarizeSamples([])).toThrow(/non-empty/u);
    expect(() => summarizeSamples([1, Number.NaN])).toThrow(/finite/u);
  });
});

describe("performance budgets", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("distinguishes pass, warning, and failure ceilings", () => {
    const budget = { failure: 120, warning: 100 };

    expect(evaluateBudget("metric", 100, budget).severity).toBe("pass");
    expect(evaluateBudget("metric", 101, budget).severity).toBe("warning");
    expect(evaluateBudget("metric", 121, budget).severity).toBe("failure");
  });

  it("reports warnings without turning them into failures", () => {
    vi.stubEnv("GITHUB_ACTIONS", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = reportBudgetEvaluations([
      evaluateBudget("warning metric", 11, { warning: 10, failure: 20 }),
    ]);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reports escaped GitHub annotations in Actions without changing severity", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = reportBudgetEvaluations([
      evaluateBudget("warning\nmetric%", 11, { warning: 10, failure: 20 }),
    ], { title: "Budget\rreport" });
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("::warning title=Budget%0Dreport::warning%0Ametric%25: 11 (warning > 10, failure > 20)");
  });
});
