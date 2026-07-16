import { describe, expect, it } from "vitest";
import {
  MarkdownEditorExtensionError,
  type MarkdownEditorContributionOrderTarget,
  type MarkdownEditorOrderedContribution,
} from "../src/extensionApi";
import {
  orderMarkdownEditorContributions,
  type MarkdownEditorOwnedOrderedContribution,
} from "../src/extensionContributionOrder";

type TestContribution = MarkdownEditorOrderedContribution & Readonly<{
  value?: string;
}>;

function owned(
  owner: string,
  id: string,
  extensionResolvedIndex: number,
  declarationIndex: number,
  options: Readonly<{
    lane?: string;
    before?: readonly MarkdownEditorContributionOrderTarget[];
    after?: readonly MarkdownEditorContributionOrderTarget[];
  }> = {},
): MarkdownEditorOwnedOrderedContribution<TestContribution, string> {
  return {
    owner,
    extensionResolvedIndex,
    declarationIndex,
    lane: options.lane ?? "behavior",
    contribution: {
      id,
      before: options.before,
      after: options.after,
      value: `${owner}/${id}`,
    },
  };
}

function order(
  contributions: readonly MarkdownEditorOwnedOrderedContribution<
    TestContribution,
    string
  >[],
) {
  return orderMarkdownEditorContributions(contributions, {
    contributionKind: "Test contribution",
    errorPhase: "assemble",
  });
}

function expectExtensionError(
  operation: () => unknown,
  code: string,
  phase = "assemble",
) {
  try {
    operation();
    throw new Error("Expected an extension error.");
  } catch (error) {
    expect(error).toBeInstanceOf(MarkdownEditorExtensionError);
    expect(error).toMatchObject({ code, phase });
    return error as MarkdownEditorExtensionError;
  }
}

describe("extension contribution ordering", () => {
  it("qualifies IDs and uses resolved extension, declaration, then ID order", () => {
    const ordered = order([
      owned("acme-second", "only", 1, 0),
      owned("acme-first", "zeta", 0, 1),
      owned("acme-first", "alpha", 0, 1),
      owned("acme-first", "first", 0, 0),
    ]);

    expect(ordered.map(({ qualifiedId }) => qualifiedId)).toEqual([
      "acme-first/first",
      "acme-first/alpha",
      "acme-first/zeta",
      "acme-second/only",
    ]);
    expect(Object.isFrozen(ordered)).toBe(true);
    expect(ordered.every(Object.isFrozen)).toBe(true);
  });

  it("applies before and after arrays from the same contribution", () => {
    const ordered = order([
      owned("acme-middle", "rule", 0, 0, {
        after: ["acme-left/rule"],
        before: ["acme-right/rule"],
      }),
      owned("acme-right", "rule", 1, 0),
      owned("acme-left", "rule", 2, 0),
    ]);

    expect(ordered.map(({ qualifiedId }) => qualifiedId)).toEqual([
      "acme-left/rule",
      "acme-middle/rule",
      "acme-right/rule",
    ]);
  });

  it("ignores missing explicit optional targets and resolves installed ones", () => {
    const withoutOptionalPeer = order([
      owned("acme-rule", "main", 0, 0, {
        before: [{ id: "acme-optional/rule", optional: true }],
      }),
    ]);
    expect(withoutOptionalPeer.map(({ qualifiedId }) => qualifiedId)).toEqual([
      "acme-rule/main",
    ]);

    const withOptionalPeer = order([
      owned("acme-optional", "rule", 0, 0),
      owned("acme-rule", "main", 1, 0, {
        before: [{ id: "acme-optional/rule", optional: true }],
      }),
    ]);
    expect(withOptionalPeer.map(({ qualifiedId }) => qualifiedId)).toEqual([
      "acme-rule/main",
      "acme-optional/rule",
    ]);
  });

  it("rejects missing required targets with owner and participants", () => {
    const error = expectExtensionError(() => order([
      owned("acme-rule", "main", 0, 0, {
        after: ["acme-missing/rule"],
      }),
    ]), "EXTENSION_MISSING_DEPENDENCY");

    expect(error.extension).toBe("acme-rule");
    expect(error.contribution).toBe("acme-rule/main");
    expect(error.participants).toEqual([
      "acme-rule/main",
      "acme-missing/rule",
    ]);
  });

  it("rejects installed cross-lane targets even when the edge is optional", () => {
    const error = expectExtensionError(() => order([
      owned("acme-block", "rule", 0, 0, {
        lane: "block",
        before: [{ id: "acme-inline/rule", optional: true }],
      }),
      owned("acme-inline", "rule", 1, 0, { lane: "inline" }),
    ]), "EXTENSION_INVALID_DEFINITION");

    expect(error.message).toContain('lane "block"');
    expect(error.message).toContain('lane "inline"');
  });

  it("rejects invalid local IDs and duplicate qualified IDs across lanes", () => {
    const invalid = expectExtensionError(() => order([
      owned("acme-rule", "Bad Rule", 0, 0),
    ]), "EXTENSION_INVALID_DEFINITION");
    expect(invalid.extension).toBe("acme-rule");

    const duplicate = expectExtensionError(() => order([
      owned("acme-rule", "shared", 0, 0, { lane: "first" }),
      owned("acme-rule", "shared", 0, 1, { lane: "second" }),
    ]), "EXTENSION_CONTRIBUTION_CONFLICT");
    expect(duplicate.contribution).toBe("acme-rule/shared");
    expect(duplicate.participants).toEqual(["acme-rule/shared"]);
  });

  it("reports only deterministic cycle participants, excluding downstream nodes", () => {
    const error = expectExtensionError(() => order([
      owned("acme-first", "rule", 0, 0, {
        after: ["acme-third/rule"],
      }),
      owned("acme-second", "rule", 1, 0, {
        after: ["acme-first/rule"],
      }),
      owned("acme-third", "rule", 2, 0, {
        after: ["acme-second/rule"],
      }),
      owned("acme-downstream", "rule", 3, 0, {
        after: ["acme-third/rule"],
      }),
    ]), "EXTENSION_ORDER_CYCLE");

    expect(error.participants).toEqual([
      "acme-first/rule",
      "acme-second/rule",
      "acme-third/rule",
    ]);
    expect(error.participants).not.toContain("acme-downstream/rule");
  });

  it("turns contradictory before and after edges into a cycle", () => {
    const error = expectExtensionError(() => order([
      owned("acme-first", "rule", 0, 0, {
        before: ["acme-second/rule"],
        after: ["acme-second/rule"],
      }),
      owned("acme-second", "rule", 1, 0),
    ]), "EXTENSION_ORDER_CYCLE");

    expect(new Set(error.participants)).toEqual(new Set([
      "acme-first/rule",
      "acme-second/rule",
    ]));
  });
});
