declare module "@plantuml/core" {
  export function renderToString(lines: string[], success: (svg: string) => void,
    failure: (message: string) => void, options?: { dark?: boolean; maxSvgSize?: number }): void;
}
declare module "@plantuml/core/viz-global.js";
declare module "@plantuml/core/themes.js";
