import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const targetDir = process.argv[2];

if (!targetDir) {
  throw new Error('Usage: node ./scripts/fix-node-esm-specifiers.mjs <dist-dir>');
}

const rootDir = resolve(process.cwd(), targetDir);
const textFileExtensions = new Set(['.js', '.d.ts']);

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(entryPath);
      continue;
    }

    if ([...textFileExtensions].some((extension) => entry.name.endsWith(extension))) {
      rewriteFile(entryPath);
    }
  }
}

function hasExplicitExtension(specifier) {
  return /\.[a-z0-9]+$/i.test(specifier);
}

function resolveSpecifier(filePath, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  if (hasExplicitExtension(specifier)) {
    return specifier;
  }

  const absoluteSpecifier = resolve(dirname(filePath), specifier);

  if (existsSync(`${absoluteSpecifier}.js`)) {
    return `${specifier}.js`;
  }

  if (existsSync(join(absoluteSpecifier, 'index.js'))) {
    return `${specifier}/index.js`;
  }

  return specifier;
}

function rewriteSpecifiers(source, filePath) {
  const patterns = [
    /(\bfrom\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
  ];

  return patterns.reduce(
    (currentSource, pattern) => currentSource.replace(pattern, (_match, prefix, specifier, suffix) => {
      const resolvedSpecifier = resolveSpecifier(filePath, specifier);
      return `${prefix}${resolvedSpecifier}${suffix}`;
    }),
    source,
  );
}

function rewriteFile(filePath) {
  const stat = statSync(filePath);

  if (!stat.isFile()) {
    return;
  }

  const source = readFileSync(filePath, 'utf8');
  const nextSource = rewriteSpecifiers(source, filePath);

  if (nextSource !== source) {
    writeFileSync(filePath, nextSource);
  }
}

walk(rootDir);
