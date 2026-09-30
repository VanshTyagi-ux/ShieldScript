import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// The scans made in this tab, newest first, kept in sessionStorage (gone when the tab closes). Text is
// truncated, the list is capped, and a blocked or corrupt store never breaks the app.
export const HISTORY_KEY = "xssd-history";
export const MAX_HISTORY = 50;
const MAX_TEXT = 300;

const HistoryContext = createContext(null);

const isEntry = (e) => Boolean(e) && typeof e === "object" && typeof e.id === "string" && typeof e.text === "string"
  && Number.isFinite(e.ts) && Number.isFinite(e.score) && typeof e.level === "string" && typeof e.is_malicious === "boolean";

// Pure: put `entry` first; a consecutive duplicate of the newest text replaces it; keep at most MAX_HISTORY.
export function addEntry(list, entry) {
  const next = { ...entry, text: entry.text.slice(0, MAX_TEXT) };
  const rest = list.length && list[0].text === next.text ? list.slice(1) : list;
  return [next, ...rest].slice(0, MAX_HISTORY);
}

function readStored() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(HISTORY_KEY));
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_HISTORY) : [];
  } catch (_) {
    return []; // blocked storage or unparseable data
  }
}

export function HistoryProvider({ children }) {
  const [entries, setEntries] = useState(readStored);
  const counter = useRef(0);

  useEffect(() => {
    try { window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch (_) { /* memory only */ }
  }, [entries]);

  const add = useCallback((result, text) => {
    const entry = {
      id: `${Date.now().toString(36)}-${++counter.current}`,
      ts: Date.now(), text, score: result.score, level: result.level, is_malicious: Boolean(result.is_malicious),
    };
    setEntries((list) => addEntry(list, entry));
  }, []);
  const remove = useCallback((id) => setEntries((list) => list.filter((e) => e.id !== id)), []);
  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo(() => ({ entries, add, remove, clear }), [entries, add, remove, clear]);
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory() {
  const value = useContext(HistoryContext);
  if (!value) throw new Error("useHistory must be used inside a HistoryProvider");
  return value;
}
