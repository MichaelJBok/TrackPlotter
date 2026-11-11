import { useMemo, useState } from "react";

interface Props {
  items: string[];
  value: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  rows?: number;
  showSearch?: boolean;
}

const ROW_HEIGHT = 19;

/** An alphabetically sorted list box showing `rows` items at once (scrolling
 * for the rest), in place of a native <select> dropdown. Optionally has a
 * text filter above it (showSearch, on by default). */
export default function ListBox({
  items, value, onSelect, placeholder, emptyMessage = "No items", rows = 10, showSearch = true,
}: Props) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q ? items.filter((i) => i.toLowerCase().includes(q)) : items;
    return matched.slice().sort((a, b) => a.localeCompare(b));
  }, [items, filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
        style={{
          border: "1px solid #ccc",
          borderRadius: 4,
          maxHeight: ROW_HEIGHT * rows,
          overflowY: "auto",
          background: "white",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: "#999" }}>{emptyMessage}</div>
        ) : (
          filtered.map((item) => (
            <div
              key={item}
              onClick={() => onSelect(item)}
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
                background: item === value ? "#dce7f7" : "transparent",
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
