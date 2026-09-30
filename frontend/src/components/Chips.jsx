export function Chips({ result }) {
  const layers = result.decode_layers;
  const ml = result.ml_probability == null
    ? "ML model not trained (python -m xss_detector train)"
    : `ML: ${(result.ml_probability * 100).toFixed(1)}% malicious`;
  return (
    <div id="chips" className="chips">
      {layers ? <span className="chip">{`encoded: ${layers} decoding layer${layers > 1 ? "s" : ""}`}</span> : null}
      <span className="chip">{ml}</span>
      <span className={`chip ${result.is_malicious ? "bad" : "ok"}`}>{result.is_malicious ? "blocked" : "allowed"}</span>
    </div>
  );
}
