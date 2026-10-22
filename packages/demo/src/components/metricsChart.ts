import { defineComponent, type ComponentEditRequest } from "markora-extension-components";

type Metric = "cpu" | "memory" | "requests";
export type MetricsChartProps = {
  title: string;
  metric: Metric;
  window: number;
  color: "teal" | "blue" | "violet";
};

const metrics = {
  cpu: { label: "CPU utilization", value: "34.8", unit: "%", change: "−4.2%", baseline: 48 },
  memory: { label: "Memory usage", value: "6.4", unit: "GiB", change: "+0.3 GiB", baseline: 64 },
  requests: { label: "HTTP requests", value: "1,248", unit: "req/s", change: "+12.6%", baseline: 36 },
};

let settingsSequence = 0;

function parseMetricsProps(value: unknown): MetricsChartProps {
  const props = value as Partial<MetricsChartProps>;
  if (typeof props.title !== "string" || !props.title.trim() || props.title.length > 100) {
    throw new TypeError("Give the chart a title between 1 and 100 characters.");
  }
  if (!props.metric || !Object.prototype.hasOwnProperty.call(metrics, props.metric)) throw new TypeError("Choose a supported metric.");
  if (![5, 15, 60].includes(props.window ?? 0)) throw new TypeError("Choose a 5, 15, or 60 minute window.");
  if (!["teal", "blue", "violet"].includes(props.color ?? "")) throw new TypeError("Choose a supported chart color.");
  return { title: props.title, metric: props.metric, window: props.window!, color: props.color! };
}

function editChart(request: ComponentEditRequest<MetricsChartProps>) {
  const document = request.anchor.ownerDocument;
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "metrics-dialog";
  dialog.setAttribute("aria-label", "Configure metrics chart");
  const kicker = document.createElement("span");
  kicker.className = "card-kicker";
  kicker.textContent = "COMPONENT SETTINGS";
  const heading = document.createElement("h2");
  heading.textContent = "Configure metrics chart";
  const description = document.createElement("p");
  description.textContent = "Chart settings live in your Markdown. Changes are undoable.";
  const form = document.createElement("form");
  const dialogId = `metrics-settings-${++settingsSequence}`;
  let fieldIndex = 0;
  const title = document.createElement("input");
  title.value = request.props.title;
  title.required = true;
  title.maxLength = 100;
  const field = (labelText: string, control: HTMLElement) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    control.id = `${dialogId}-${fieldIndex++}`;
    label.htmlFor = control.id;
    form.append(label, control);
  };
  const select = (choices: readonly (readonly [string, string])[], value: string) => {
    const control = document.createElement("select");
    for (const [optionValue, text] of choices) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = text;
      control.append(option);
    }
    control.value = value;
    return control;
  };
  const metric = select(Object.entries(metrics).map(([key, value]) => [key, value.label]), request.props.metric);
  const window = select([["5", "Last 5 minutes"], ["15", "Last 15 minutes"], ["60", "Last hour"]], String(request.props.window));
  const color = select([["teal", "Teal"], ["blue", "Blue"], ["violet", "Violet"]], request.props.color);
  field("Chart title", title);
  field("Metric", metric);
  field("Time window", window);
  field("Chart color", color);
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  const actions = document.createElement("div");
  actions.className = "metrics-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button button-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", request.cancel);
  const submit = document.createElement("button");
  submit.className = "button button-primary";
  submit.textContent = "Save chart";
  actions.append(cancel, submit);
  form.append(error, actions);
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const saved = request.update({ title: title.value, metric: metric.value as Metric, window: Number(window.value), color: color.value as MetricsChartProps["color"] });
      if (!saved) error.textContent = "The component changed. Close this dialog and try again.";
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "Invalid chart settings.";
    }
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); request.cancel(); });
  dialog.append(kicker, heading, description, form);
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
  return () => {
    dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
}

export const metricsChart = defineComponent({
  name: "metrics-chart",
  label: "Metrics chart",
  parseProps: parseMetricsProps,
  edit: editChart,
  render({ element, props }) {
    const document = element.ownerDocument;
    const metric = metrics[props.metric];
    element.className = `metrics-chart metrics-chart-${props.color}`;
    const top = document.createElement("div");
    top.className = "metrics-chart-top";
    const title = document.createElement("strong");
    title.className = "metrics-chart-title";
    title.textContent = props.title;
    const label = document.createElement("span");
    label.className = "metrics-chart-window";
    label.textContent = `Last ${props.window} minutes`;
    top.append(title, label);
    const value = document.createElement("div");
    value.className = "metrics-chart-value";
    value.textContent = metric.value;
    const unit = document.createElement("small");
    unit.textContent = metric.unit;
    const change = document.createElement("span");
    change.textContent = `${metric.change} vs. previous window`;
    value.append(unit, change);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 640 160");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${props.title}: synthetic sample data over ${props.window} minutes`);
    const points = Array.from({ length: 65 }, (_, index) => {
      const height = metric.baseline + Math.sin(index * 0.37) * 17 + Math.sin(index * 1.3) * 8 + Math.cos(index * 0.17 + props.window) * 22;
      return `${index * 10},${Math.round(140 - height)}`;
    });
    for (const height of [20, 60, 100, 140]) {
      const line = document.createElementNS(svg.namespaceURI, "path");
      line.setAttribute("d", `M0 ${height} H640`);
      line.setAttribute("class", "metrics-chart-grid");
      svg.append(line);
    }
    const area = document.createElementNS(svg.namespaceURI, "path");
    area.setAttribute("d", `M${points.join(" L")} L640 160 L0 160 Z`);
    area.setAttribute("class", "metrics-chart-area");
    const line = document.createElementNS(svg.namespaceURI, "path");
    line.setAttribute("d", `M${points.join(" L")}`);
    line.setAttribute("class", "metrics-chart-line");
    svg.append(area, line);
    const legend = document.createElement("div");
    legend.className = "metrics-chart-legend";
    const start = document.createElement("span");
    start.textContent = `${props.window} minutes ago`;
    const end = document.createElement("span");
    end.textContent = "now · synthetic sample data";
    legend.append(start, end);
    element.append(top, value, svg, legend);
  },
});
