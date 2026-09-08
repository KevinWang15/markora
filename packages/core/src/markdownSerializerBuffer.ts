/*!
 * Output-writing semantics adapted from prosemirror-markdown.
 * Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node } from "prosemirror-model";

type SerializerRuntime = MarkdownSerializerState & {
  out: string;
  delim: string;
  closed: Node | null;
  atBlockStart: boolean;
  atBlank(): boolean;
  flushClose(size?: number): void;
};

/** ProseMirror's writer repeatedly tests a growing output string with regular
 * expressions. V8 flattens the concatenated string on those tests, making large
 * documents quadratic. Keep chunks and a two-character suffix instead.
 *
 * This adapter mirrors only the output-writing methods; block/mark rendering and
 * escaping remain upstream. The `out` property stays readable/writable for custom
 * serializers. Differential tests guard the compatibility boundary. */
export function bufferMarkdownSerializerOutput(state: MarkdownSerializerState): void {
  const runtime = state as SerializerRuntime;
  let chunks: string[] = runtime.out ? [runtime.out] : [];
  let suffix = runtime.out.slice(-2);
  const append = (text: string) => {
    if (!text) return;
    chunks.push(text);
    suffix = (suffix + text.slice(-2)).slice(-2);
  };
  Object.defineProperty(runtime, "out", {
    configurable: true,
    enumerable: true,
    get() {
      const output = chunks.join("");
      chunks = output ? [output] : [];
      return output;
    },
    set(output: string) {
      chunks = output ? [output] : [];
      suffix = output.slice(-2);
    },
  });

  runtime.atBlank = () => !suffix || suffix.endsWith("\n");
  runtime.ensureNewLine = () => {
    if (!runtime.atBlank()) append("\n");
  };
  runtime.flushClose = (size = 2) => {
    if (!runtime.closed) return;
    runtime.ensureNewLine();
    if (size > 1) {
      const delimiter = runtime.delim.replace(/\s+$/, "");
      for (let index = 1; index < size; index += 1) append(delimiter + "\n");
    }
    runtime.closed = null;
  };
  runtime.write = content => {
    runtime.flushClose();
    if (runtime.delim && runtime.atBlank()) append(runtime.delim);
    if (content) append(content);
  };
  runtime.text = (text, escape = true) => {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      runtime.write();
      if (!escape && lines[index][0] === "[" && /(^|[^\\])!$/.test(suffix)) {
        const last = chunks.pop()!;
        chunks.push(last.slice(0, -1) + "\\!");
        suffix = "\\!";
      }
      append(escape ? runtime.esc(lines[index], runtime.atBlockStart) : lines[index]);
      if (index !== lines.length - 1) append("\n");
    }
  };
}
