import type { EditorUiFactory } from "markora";
import {
  createDefaultUi,
  defaultUiMessages,
  type DefaultUiConfig,
  type DefaultUiMessageOverrides,
  type DefaultUiMessages,
  type DefaultUiTableAction,
  type DefaultUiTableActionStatusContext,
  type DefaultUiTableControl,
  type DefaultUiTableGroup,
  type DefaultUiTableMode,
  type DefaultUiTableSelectionContext,
} from "../src/index";

declare const portalRoot: ShadowRoot;

const selection: DefaultUiTableSelectionContext = {
  columnFrom: 1,
  columnTo: 2,
  rowFrom: 3,
  rowTo: 4,
};
const action: DefaultUiTableAction = "insert-row-after";
const actionStatus: DefaultUiTableActionStatusContext = { action, selection };
const control: DefaultUiTableControl = "resize-table";
const group: DefaultUiTableGroup = "alignment";
const mode: DefaultUiTableMode = "resize";

const messages: DefaultUiMessages = {
  ...defaultUiMessages,
  tableActionStatus(context) {
    const typedContext: DefaultUiTableActionStatusContext = context;
    return `${typedContext.action}`;
  },
  tableControlLabel(value) {
    const typedControl: DefaultUiTableControl = value;
    return typedControl;
  },
  tableGroupLabel(value) {
    const typedGroup: DefaultUiTableGroup = value;
    return typedGroup;
  },
  tableSelectionStatus(context) {
    const typedSelection: DefaultUiTableSelectionContext = context;
    return `${typedSelection.rowFrom}`;
  },
};
const overrides: DefaultUiMessageOverrides = {
  cancelButtonLabel: "Dismiss",
  tableActionStatus: messages.tableActionStatus,
};
const config: DefaultUiConfig = { messages: overrides, portalRoot };
const factory: EditorUiFactory = createDefaultUi(config);

void actionStatus;
void control;
void factory;
void group;
void mode;

// @ts-expect-error Message keys are closed so locale typos fail at compile time.
createDefaultUi({ messages: { saveButtonLable: "Save" } });

// @ts-expect-error Dynamic messages require formatter functions.
createDefaultUi({ messages: { tableControlLabel: "Control" } });

// @ts-expect-error Table contexts use one-based numeric coordinates.
const invalidSelection: DefaultUiTableSelectionContext = { columnFrom: "1" };
void invalidSelection;

createDefaultUi({ contextMenu: {
  includeExtensionActions: true,
  messages: { itemLabel: (id, label) => `${id}: ${label}` },
  providers: [{ id: "host", order: 25, items: context => [{
    type: "action", id: "host.heading", label: "Heading",
    enabled: context.editor.state.can.setHeading(2),
    run: current => current.editor.commands.setHeading(2),
  }] }],
  clipboard: { read: async () => ({ text: "hello", html: "<p>hello</p>" }), write: async content => { void content.markdown; } },
} });
createDefaultUi({ contextMenu: false });
// @ts-expect-error A command callback is required on an action.
createDefaultUi({ contextMenu: { providers: [{ id: "host", items: () => [{ type: "action", id: "missing", label: "Missing" }] }] } });
