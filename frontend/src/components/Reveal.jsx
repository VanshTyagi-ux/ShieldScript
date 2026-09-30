import { useReveal } from "../lib/useReveal.js";

// Fades content in as it scrolls into view. Without IntersectionObserver, or under reduced motion, it is
// visible from the start, so nothing is ever hidden.
export function Reveal({ children, className = "" }) {
  const [ref, visible] = useReveal();
  return <div ref={ref} className={`reveal${visible ? " is-visible" : ""} ${className}`.trim()}>{children}</div>;
}
