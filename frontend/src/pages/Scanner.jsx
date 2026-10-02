import { useEffect, useState } from "react";
import { ProtectedForm } from "../components/ProtectedForm.jsx";
import { ResultActions } from "../components/ResultActions.jsx";
import { ResultPanel } from "../components/ResultPanel.jsx";
import { Scanner as ScannerInput } from "../components/Scanner.jsx";
import { SessionInsights } from "../components/SessionInsights.jsx";
import { PageHeading } from "../layout/PageHeading.jsx";
import { announcementFor } from "../format.js";
import { useScan } from "../hooks/useScan.js";
import { useAnnounce } from "../lib/announce.jsx";
import { useHistory } from "../lib/history.jsx";
import { useRoute } from "../lib/router.jsx";
import { decodeShare } from "../lib/share.js";

export function ScannerPage() {
  const { search } = useRoute();
  const [text, setText] = useState(() => decodeShare(new URLSearchParams(search).get("t")) ?? "");
  const announce = useAnnounce();
  const scan = useScan(text);
  const { entries, add, clear } = useHistory();

  useEffect(() => {
    if (scan.status === "ok") announce(announcementFor(scan.result));
  }, [scan.status, scan.result, announce]);

  // A result only arrives for the latest text (older requests are aborted), so `text` is what was scanned.
  useEffect(() => {
    if (scan.status === "ok" && scan.result && text.trim().length >= 3) add(scan.result, text);
  }, [scan.result]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <PageHeading description="Type or paste input to see how it scores. Every scan runs on the live detector.">Scanner</PageHeading>
      <div className="page-grid scanner-grid">
        <div className="scan-input"><ScannerInput text={text} onChange={setText} /></div>
        <div className="scan-result">
          <ResultPanel scan={scan} footer={scan.result ? <ResultActions result={scan.result} text={text} /> : null} />
        </div>
        <div className="scan-insights">
          <SessionInsights entries={entries} onRerun={setText} onClear={clear} />
        </div>
        <ProtectedForm onAnnounce={announce} />
      </div>
    </div>
  );
}
