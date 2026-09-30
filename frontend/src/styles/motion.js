// Reduced motion. Must be the LAST module in the stylesheet so it wins over every animation and transition.
export const MOTION = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
