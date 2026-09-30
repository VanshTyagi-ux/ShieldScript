// Test environment stubs for browser APIs jsdom does not implement. Tests that need different
// behaviour (reduced motion, IntersectionObserver, ...) override these per test.
window.matchMedia = (media) => ({
  matches: false,
  media,
  addEventListener() {},
  removeEventListener() {},
});
window.scrollTo = () => {};
