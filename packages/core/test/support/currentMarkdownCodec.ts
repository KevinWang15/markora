import { createMarkdownCodec } from "../../src/markdownCodec";

const codec = createMarkdownCodec();

export const schema = codec.schema;
export const markdownSerializer = codec.serializer;
export const parseMarkdown = codec.parse;
export const createImportedContentSanitizerPlugin =
  codec.createImportedContentSanitizerPlugin;
export const createTableCellContentFromMarkdown =
  codec.createTableCellContentFromMarkdown;
