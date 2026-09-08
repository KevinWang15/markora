import {
  createTocExtension,
  defaultTocMessages,
} from "markora-extension-toc";
import "markora-extension-toc/styles.css";

export const packedTocDefinitions = [
  createTocExtension(),
  createTocExtension({
    messages: {
      navigationLabel: (occurrence, total) =>
        "Packed contents " + occurrence + " of " + total,
      untitledHeadingLabel: (level, index) =>
        "Packed untitled " + index + " at level " + level,
    },
  }),
];

export const packedTocSurface = [
  defaultTocMessages.navigationLabel(1, 2),
  defaultTocMessages.goToHeadingLabel("Packed", 1, 1),
  ...packedTocDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
