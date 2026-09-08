function assertBudget(budget, label) {
  if (
    !budget
    || typeof budget.warning !== "number"
    || !Number.isFinite(budget.warning)
    || typeof budget.failure !== "number"
    || !Number.isFinite(budget.failure)
    || budget.warning > budget.failure
  ) {
    throw new TypeError(`${label} must define finite warning and failure ceilings.`);
  }
}

export function evaluateBudget(label, value, budget) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} produced a non-finite value.`);
  }
  assertBudget(budget, label);

  const severity = value > budget.failure
    ? "failure"
    : value > budget.warning
      ? "warning"
      : "pass";

  return Object.freeze({
    failure: budget.failure,
    label,
    severity,
    value,
    warning: budget.warning,
  });
}

function escapeWorkflowValue(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

export function reportBudgetEvaluations(evaluations, { title = "Markora performance budget" } = {}) {
  const warnings = evaluations.filter(({ severity }) => severity === "warning");
  const failures = evaluations.filter(({ severity }) => severity === "failure");

  for (const evaluation of evaluations) {
    const message = `${evaluation.label}: ${evaluation.value} (warning > ${evaluation.warning}, failure > ${evaluation.failure})`;
    if (evaluation.severity === "pass") {
      console.log(`PASS ${message}`);
    } else if (process.env.GITHUB_ACTIONS) {
      const command = evaluation.severity === "failure" ? "error" : "warning";
      console.log(`::${command} title=${escapeWorkflowValue(title)}::${escapeWorkflowValue(message)}`);
    } else {
      console.warn(`${evaluation.severity.toUpperCase()} ${message}`);
    }
  }

  return Object.freeze({
    failures: Object.freeze(failures),
    passed: failures.length === 0,
    warnings: Object.freeze(warnings),
  });
}
export function selectStatistic(summary, budget, label, fallbackStatistic) {
  const statistic = budget?.statistic ?? fallbackStatistic;
  const value = typeof statistic === "string" ? summary?.[statistic] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} has no valid configured summary statistic.`);
  }
  return value;
}

/** Keep typical performance and occasional slow samples independently bounded. */
export function evaluateSummaryBudgets(label, summary, budget, fallbackStatistic) {
  const evaluations = [evaluateBudget(label, selectStatistic(summary, budget, label, fallbackStatistic), budget)];
  const additional = budget.additionalStatistics;
  if (additional !== undefined) {
    if (!additional || typeof additional !== "object" || Array.isArray(additional)) {
      throw new TypeError(`${label} additionalStatistics must be a statistic-to-budget record.`);
    }
    for (const [statistic, thresholds] of Object.entries(additional)) {
      const statisticLabel = `${label}.${statistic}`;
      evaluations.push(evaluateBudget(statisticLabel,
        selectStatistic(summary, { statistic }, statisticLabel), thresholds));
    }
  }
  return Object.freeze(evaluations);
}
