import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  items: string[];
  value: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  rows?: number;
  showSearch?: boolean;
  dark?: boolean;
}

const ROW_HEIGHT = 19;

/** An alphabetically sorted list box showing `rows` items at once (scrolling
 * for the rest), in place of a native <select> dropdown. Optionally has a
 * text filter above it (showSearch, on by default). ArrowUp/ArrowDown step
 * through the (filtered) list - from the search input, or from the list
 * itself once a row's been clicked - instead of scrolling the page, which
 * is what happens by default when no focusable control catches the key. */
export default function ListBox({
  items, value, onSelect, placeholder, emptyMessage = "No items", rows = 10, showSearch = true, dark = false,
}: Props) {
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q ? items.filter((i) => i.toLowerCase().includes(q)) : items;
    return matched.slice().sort((a, b) => a.localeCompare(b));
  }, [items, filter]);

  // Keeps the selected row in view, whether it moved via arrow keys or a
  // click near the edge of the visible window.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || value == null) return;
    const idx = filtered.indexOf(value);
    if (idx < 0) return;
    const top = idx * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [value, filtered]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (filtered.length === 0) return;
    e.preventDefault(); // otherwise the browser just scrolls the page
    const idx = value != null ? filtered.indexOf(value) : -1;
    const nextIdx =
      e.key === "ArrowDown" ? Math.min(filtered.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
    onSelect(filtered[nextIdx]);
  }

  function handleRowClick(item: string) {
    onSelect(item);
    // So arrow keys keep working right after a click, with no search input
    // to hold focus (the Animal list has none).
    containerRef.current?.focus();
  }

  return (
    <div onKeyDown={handleKeyDown} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {showSearch && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={placeholder}
          disabled={items.length === 0}
          style={{ fontSize: 12, padding: "3px 6px", boxSizing: "border-box" }}
        />
      )}
      <div
        ref={containerRef}
        tabIndex={items.length === 0 ? undefined : 0}
        style={{
          border: dark ? "1px solid #444" : "1px solid #ccc",
          borderRadius: 4,
          maxHeight: ROW_HEIGHT * rows,
          overflowY: "auto",
          background: dark ? "#1c1c1c" : "white",
          color: dark ? "#e6e6e6" : undefined,
          outline: "none",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: dark ? "#777" : "#999" }}>{emptyMessage}</div>
        ) : (
          filtered.map((item) => (
            <div
              key={item}
              onClick={() => handleRowClick(item)}
              title={item}
              style={{
                height: ROW_HEIGHT,
                lineHeight: `${ROW_HEIGHT}px`,
                padding: "0 8px",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                background: item === value ? (dark ? "#2c4a7c" : "#dce7f7") : "transparent",
              }}
            >
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
