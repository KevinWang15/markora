import type { MarkdownEditorExtensionRegistry } from "markora/extension-api";
import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
  type AlertKind,
  type AlertSnapshot,
  type AlertsCommands,
  type AlertsExtension,
  type AlertsExtensionOptions,
  type AlertsMessageOverrides,
  type AlertsMessages,
  type AlertsState,
} from "../src/index";

const messages: AlertsMessageOverrides = {
  alertLabel: (_kind, kindLabel) => `Notice: ${kindLabel}`,
  noteKindLabel: "Information",
};
const options: AlertsExtensionOptions = { messages };
const extension: AlertsExtension = createAlertsExtension(options);

declare const registry: MarkdownEditorExtensionRegistry;
const handle = registry.get(extension);
const commands: AlertsCommands = handle.commands;
const state: AlertsState = handle.state;
const wrapped: boolean = commands.wrap("important");
const toggled: boolean = commands.toggle();
const changed: boolean = commands.setKind("warning");
const unwrapped: boolean = commands.unwrap();
const active: AlertSnapshot | null = state.getActive();
const alerts: readonly AlertSnapshot[] = state.getAlerts();
const canWrap: boolean = state.canWrap("tip");
const canToggle: boolean = state.canToggle();
const canSetKind: boolean = state.canSetKind("caution");
const canUnwrap: boolean = state.canUnwrap();
const isActive: boolean = state.isActive();
const kind: AlertKind = alertKinds[0];
const defaults: AlertsMessages = defaultAlertsMessages;
void wrapped;
void toggled;
void changed;
void unwrapped;
void active;
void alerts;
void canWrap;
void canToggle;
void canSetKind;
void canUnwrap;
void isActive;
void kind;
void defaults;

// @ts-expect-error Alert kinds are a closed contract.
commands.wrap("danger");

// @ts-expect-error Message overrides are restricted to package-owned copy.
createAlertsExtension({ messages: { unknownLabel: "Unknown" } });

// @ts-expect-error Options use a closed runtime-only surface.
createAlertsExtension({ messages, unknownOption: true });

// @ts-expect-error Public kind collections are immutable.
alertKinds.push("note");

// @ts-expect-error State snapshots are immutable.
alerts.push({ kind: "note", position: 0 });
