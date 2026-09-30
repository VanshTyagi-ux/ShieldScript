export function Shield({ size = 28 }) {
  return (
    <svg className="shield" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M32 4 8 13v17c0 15 10 26 24 30 14-4 24-15 24-30V13L32 4z" fill="currentColor" />
      <path className="shield-check" d="m22 32 7 7 14-15" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
