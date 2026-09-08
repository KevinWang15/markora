import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const sourcePath = resolve(packageRoot, "src/styles.css");
const themesSourcePath = resolve(packageRoot, "src/themes.css");
const outputPath = resolve(packageRoot, "dist/styles.css");
const minimalOutputPath = resolve(packageRoot, "dist/minimal.css");
const themesOutputPath = resolve(packageRoot, "dist/themes.css");

function findClosingBrace(source, openingBrace) {
  let depth = 1;
  let quote = null;

  for (let index = openingBrace + 1; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }

  throw new Error("Markora stylesheet contains an unbalanced rule.");
}

function splitSelectorList(prelude) {
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\\") {
      index += 1;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "/" && prelude[index + 1] === "*") {
      const commentEnd = prelude.indexOf("*/", index + 2);
      index = commentEnd < 0 ? prelude.length : commentEnd + 1;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(prelude.slice(start));
  return selectors;
}

function isRootOnlySelector(selector) {
  return (
    selector.includes(".cm-")
    || selector.includes(".mdw-code-block")
    || selector.includes(".mdw-opaque-")
    || selector.includes(".mdw-task-")
    || selector.includes("[data-task=")
    || /(^|[^\w-])(table|thead|tbody|tr|th|td)(?=$|[^\w-])/.test(selector)
  );
}

function filterMinimalSelectors(prelude) {
  const selectors = splitSelectorList(prelude).filter((selector) => (
    !isRootOnlySelector(selector)
  ));

  return selectors.length > 0 ? selectors.join(",") : null;
}

function createMinimalStyles(source) {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const openingBrace = source.indexOf("{", cursor);

    if (openingBrace < 0) {
      output += source.slice(cursor);
      break;
    }

    const closingBrace = findClosingBrace(source, openingBrace);
    const prelude = source.slice(cursor, openingBrace);
    const body = source.slice(openingBrace + 1, closingBrace);
    const trimmedPrelude = prelude.trimStart();

    if (/^@(media|supports|layer|container)\b/.test(trimmedPrelude)) {
      output += `${prelude}{${createMinimalStyles(body)}}`;
    } else if (trimmedPrelude.startsWith("@")) {
      output += `${prelude}{${body}}`;
    } else {
      const filteredPrelude = filterMinimalSelectors(prelude);

      if (filteredPrelude) {
        output += `${filteredPrelude}{${body}}`;
      }
    }

    cursor = closingBrace + 1;
  }

  return `${output.trimEnd()}\n`;
}

await mkdir(dirname(outputPath), { recursive: true });
const styles = await readFile(sourcePath, "utf8");
const themes = await readFile(themesSourcePath, "utf8");
const minimalStyles = createMinimalStyles(styles);

if (
  minimalStyles
    .split("{")
    .some((prelude) => isRootOnlySelector(prelude.slice(prelude.lastIndexOf("}") + 1)))
) {
  throw new Error("Minimal Markora styles unexpectedly retain root-only selectors.");
}

for (const requiredSelector of [
  ".ProseMirror.mdw-has-managed-block-cursor",
  ".mdw-host .mdw-managed-block-cursor",
  ".mdw-host .mdw-managed-block-cursor-before::before",
  ".mdw-host .mdw-managed-block-cursor-after::after",
]) {
  if (!minimalStyles.includes(requiredSelector)) {
    throw new Error(`Minimal Markora styles omitted the managed block selector ${requiredSelector}.`);
  }
}

await Promise.all([
  writeFile(outputPath, styles),
  writeFile(minimalOutputPath, minimalStyles),
  writeFile(themesOutputPath, themes),
]);
