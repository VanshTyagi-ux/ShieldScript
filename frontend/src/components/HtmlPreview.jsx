// Renders sanitized HTML as a page would, but inside an iframe with an empty `sandbox` attribute: no scripts, no
// forms, no popups, no same-origin access, no top-level navigation. So even if the sanitizer had a bug, nothing
// could run in (or reach) this page. The HTML is handed over as `srcDoc`, never written into this document.
export function HtmlPreview({ html }) {
  return (
    <iframe
      className="html-preview"
      title="Rendered preview of the sanitized HTML"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  );
}
