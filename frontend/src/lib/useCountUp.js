import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

const easeOut = (p) => 1 - (1 - p) ** 3;

// Animates from 0 to `target`. Returns `target` straight away when inactive or under reduced motion.
export function useCountUp(target, { duration = 900, active = true } = {}) {
  const reduced = useReducedMotion();
  const still = reduced || !active;
  const [value, setValue] = useState(still ? target : 0);

  useEffect(() => {
    if (still) {
      setValue(target);
      return undefined;
    }
    let frame;
    let start;
    const tick = (now) => {
      if (start === undefined) start = now;
      const progress = Math.min(1, (now - start) / duration);
      setValue(progress === 1 ? target : target * easeOut(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setValue(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, still]);

  return value;
}
