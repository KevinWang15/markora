import {
  FRONTMATTER_MAX_SOURCE_BYTES,
  createFrontmatterExtension,
  defaultFrontmatterMessages,
} from "markora-extension-frontmatter";
import "markora-extension-frontmatter/styles.css";

export const packedFrontmatterDefinitions = [
  createFrontmatterExtension(),
  createFrontmatterExtension({
    messages: { editSource: "Edit packed metadata" },
  }),
];

export const packedFrontmatterSurface = [
  FRONTMATTER_MAX_SOURCE_BYTES,
  defaultFrontmatterMessages.kindLabel,
  ...packedFrontmatterDefinitions.map(({ name, version }) => name + "@" + version),
].join(":");
