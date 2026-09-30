import { createContext, useCallback, useContext, useState } from "react";

const AnnounceContext = createContext(null);

// One polite live region for the whole app: announce("...") tells screen-reader users what changed.
export function AnnounceProvider({ children }) {
  const [message, setMessage] = useState("");
  const announce = useCallback((next) => setMessage(next), []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div id="announce" className="sr-only" aria-live="polite">{message}</div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce() {
  const announce = useContext(AnnounceContext);
  if (!announce) throw new Error("useAnnounce must be used inside an AnnounceProvider");
  return announce;
}
