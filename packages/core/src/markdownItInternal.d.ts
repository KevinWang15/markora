declare module "markdown-it/lib/rules_block/reference.mjs" {
  import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

  export default function referenceRule(
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
  ): boolean;
}
