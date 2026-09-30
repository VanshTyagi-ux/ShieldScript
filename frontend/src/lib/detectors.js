// Each detector keeps one colour on every chart. The shipped detector is slot 1.
export const DETECTOR_SLOTS = {
  "Hybrid (rules; ML escalates)": 1,
  "Rules": 2,
  "ML alone": 3,
  "Naive hybrid (rules OR ML)": 4,
};

// name -> slot for a list of detector names. Names we do not know take slots 5 and 6 in order of
// appearance, and share slot 6 beyond that (the palette has six colours and is never extended).
export function detectorSlots(names) {
  const slots = {};
  let extra = 0;
  for (const name of names) {
    slots[name] = DETECTOR_SLOTS[name] ?? Math.min(6, 5 + extra++);
  }
  return slots;
}
