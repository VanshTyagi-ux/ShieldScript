// Counters for the live feed, computed from the events currently in view.
// -> { scanned, blocked, allowed, topRules: [{ rule, count }] } (top 5 rules, most triggered first, ties by rule id).
export function summarize(events) {
  const counts = new Map();
  let blocked = 0;
  for (const event of events) {
    if (event.blocked) blocked += 1;
    for (const rule of event.rules) counts.set(rule, (counts.get(rule) || 0) + 1);
  }
  const topRules = [...counts]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || (a.rule < b.rule ? -1 : 1))
    .slice(0, 5);
  return { scanned: events.length, blocked, allowed: events.length - blocked, topRules };
}
