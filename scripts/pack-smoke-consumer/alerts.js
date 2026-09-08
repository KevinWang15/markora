import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
} from "markora-extension-alerts";
import "markora-extension-alerts/styles.css";

export const packedAlertsDefinitions = [
  createAlertsExtension(),
  createAlertsExtension({
    messages: { toggleAlert: "Toggle packed note alert" },
  }),
];

export const packedAlertsSurface = [
  alertKinds.join(","),
  defaultAlertsMessages.alertLabel("note", defaultAlertsMessages.noteKindLabel),
  defaultAlertsMessages.invalidDocumentDiagnostic("unknown"),
  ...packedAlertsDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
