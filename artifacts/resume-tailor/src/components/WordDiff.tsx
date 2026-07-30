import type { ReactNode } from "react";

type Part = { value: string; changed: boolean };

function tokens(value: string) {
  return value.match(/\s+|[\p{L}\p{N}+#.'’-]+|[^\s]/gu) ?? [];
}

function wordDiff(original: string, proposed: string) {
  const a = tokens(original);
  const b = tokens(proposed);
  const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i].toLowerCase() === b[j].toLowerCase()
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const left: Part[] = [];
  const right: Part[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].toLowerCase() === b[j].toLowerCase()) {
      left.push({ value: a[i], changed: false });
      right.push({ value: b[j], changed: false });
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      right.push({ value: b[j], changed: true });
      j += 1;
    } else {
      left.push({ value: a[i], changed: true });
      i += 1;
    }
  }
  return { left, right };
}

function render(parts: Part[], side: "original" | "proposed"): ReactNode {
  return parts.map((part, index) => (
    <span
      key={`${index}-${part.value}`}
      style={part.changed ? {
        backgroundColor: side === "original" ? "#FEE2E2" : "#D1FAE5",
        color: side === "original" ? "#991B1B" : "#065F46",
        textDecoration: side === "original" ? "line-through" : "none",
        borderRadius: 3,
      } : undefined}
    >
      {part.value}
    </span>
  ));
}

export function WordDiff({ original, proposed, side }: { original: string; proposed: string; side: "original" | "proposed" }) {
  const diff = wordDiff(original, proposed);
  return <>{render(side === "original" ? diff.left : diff.right, side)}</>;
}
