import { toneClass } from "./shapes.js";

// Identity is never colour alone: each swatch is decorative and sits beside a text label.
export function Legend({ items }) {
  return (
    <ul className="legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className={`legend-key ${toneClass(item, "bg")}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
