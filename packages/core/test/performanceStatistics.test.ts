import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateBudget,
  evaluateSummaryBudgets,
  selectStatistic,
  reportBudgetEvaluations,
} from "../../../scripts/performance/budget-evaluator.mjs";
import { summarizeRecords, summarizeSamples } from "../../../scripts/performance/statistics.mjs";

describe("performance statistics", () => {
  it("summarizes each metric and rejects missing measurements", () => {
    const summary = summarizeRecords([{ metrics: { time: 1 } }, { metrics: { time: 5 } }], ["time"]);
    expect(summary.time).toMatchObject({ count: 2, median: 3, maximum: 5 });
    expect(() => summarizeRecords([{ metrics: {} }], ["time"])).toThrow(/finite/u);
  });
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
  it("independently rejects a sustained slowdown and an excessive single sample", () => {
    const budget = { statistic: "maximum", warning: 90, failure: 250,
      additionalStatistics: { median: { warning: 90, failure: 180 } } };
    const check = (samples: number[]) => evaluateSummaryBudgets("edit", summarizeSamples(samples), budget);
    expect(check([110, 110, 110, 110, 208]).map(result => result.severity)).toEqual(["warning", "warning"]);
    expect(check([181, 181, 181, 181, 208]).map(result => result.severity)).toEqual(["warning", "failure"]);
    expect(check([110, 110, 110, 110, 251]).map(result => result.severity)).toEqual(["failure", "warning"]);
    expect(() => evaluateSummaryBudgets("edit", {}, budget)).toThrow(/statistic/u);
    expect(() => evaluateSummaryBudgets("edit", { maximum: 1 }, {
      ...budget, additionalStatistics: { missing: { warning: 1, failure: 2 } },
    })).toThrow(/statistic/u);
    expect(() => evaluateSummaryBudgets("edit", { maximum: 1 }, {
      ...budget, additionalStatistics: [],
    })).toThrow(/record/u);
  });
  it("requires a finite configured statistic and only uses an explicit fallback", () => {
    const summary = { maximum: 15, median: 10, p95: Number.NaN };
    expect(selectStatistic(summary, { statistic: "maximum" }, "metric")).toBe(15);
    expect(selectStatistic(summary, {}, "metric", "median")).toBe(10);
    for (const statistic of [undefined, "missing", "p95"]) {
      expect(() => selectStatistic(summary, { statistic }, "metric")).toThrow(/statistic/u);
    }
  });
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
