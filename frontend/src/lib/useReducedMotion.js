import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function mediaQuery() {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
  } catch (_) {
    return null;
  }
}

// True when the user asks for reduced motion. False (motion allowed) if the browser cannot say.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => Boolean(mediaQuery()?.matches));

  useEffect(() => {
    const query = mediaQuery();
    if (!query || !query.addEventListener) return undefined;
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
