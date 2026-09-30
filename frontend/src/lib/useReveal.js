import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

// [ref, visible]: visible turns true once the element scrolls into view. Without IntersectionObserver,
// or under reduced motion, content is visible from the start so nothing is ever hidden.
export function useReveal() {
  const reduced = useReducedMotion();
  const supported = typeof window.IntersectionObserver === "function";
  const ref = useRef(null);
  const [visible, setVisible] = useState(!supported || reduced);

  useEffect(() => {
    if (!supported || reduced) {
      setVisible(true);
      return undefined;
    }
    const element = ref.current;
    if (!element) return undefined;
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [supported, reduced]);

  return [ref, visible];
}
