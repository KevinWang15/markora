import { describe, expect, it } from "vitest";
import { createReadonlySet } from "../src/readonlySet";

describe("runtime read-only sets", () => {
  it("retain Set iteration semantics without exposing mutation methods", () => {
    const values = createReadonlySet(["alpha", "beta", "alpha"]);
    const visited: string[] = [];

    values.forEach((value, valueAgain, set) => {
      expect(valueAgain).toBe(value);
      expect(set).toBe(values);
      visited.push(value);
    });

    expect(Object.isFrozen(values)).toBe(true);
    expect(values.size).toBe(2);
    expect(values.has("alpha")).toBe(true);
    expect([...values]).toEqual(["alpha", "beta"]);
    expect([...values.entries()]).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
    expect("add" in values).toBe(false);
    expect("clear" in values).toBe(false);
    expect("delete" in values).toBe(false);
  });
});
