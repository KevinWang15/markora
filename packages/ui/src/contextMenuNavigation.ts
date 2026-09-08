export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextMenuIndex(
  key: MenuNavigationKey,
  current: number,
  count: number,
): number {
  if (!count) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (current < 0) return key === "ArrowDown" ? 0 : count - 1;
  return (current + (key === "ArrowDown" ? 1 : -1) + count) % count;
}

/** Each menu level owns its search prefix. Time is supplied by the event adapter,
 * keeping expiry and repeated-character behavior deterministic in tests. */
export function createMenuTypeahead() {
  let prefix = "";
  let lastTyped = 0;
  return {
    reset() {
      prefix = "";
      lastTyped = 0;
    },
    find(
      labels: readonly string[],
      current: number,
      key: string,
      now: number,
    ): number {
      const character = key.toLocaleLowerCase();
      prefix = now - lastTyped > 600 ? character : prefix + character;
      lastTyped = now;
      const characters = [...prefix];
      const term = characters.every((value) => value === characters[0])
        ? character
        : prefix;
      const start = [...term].length === 1 ? current + 1 : Math.max(current, 0);
      for (let offset = 0; offset < labels.length; offset += 1) {
        const index = (start + offset) % labels.length;
        if (labels[index].toLocaleLowerCase().startsWith(term)) return index;
      }
      return -1;
    },
  };
}
