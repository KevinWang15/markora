/** A compact replacement also keeps selections outside the changed span stable. */
export function textChange(before: string, after: string) {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let to = before.length, end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  return { from, to, insert: after.slice(from, end) };
}

export function mapTextPosition(position: number, change: ReturnType<typeof textChange>) {
  if (position <= change.from) return position;
  if (position >= change.to) return position + change.insert.length - (change.to - change.from);
  return change.from + Math.min(position - change.from, change.insert.length);
}
