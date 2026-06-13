import "@testing-library/jest-dom";

// jsdom does not implement Element.prototype.scrollTo. ChatBox calls it from a
// requestAnimationFrame callback (scrollToBottom), which would otherwise throw
// an unhandled error during tests. Stub it as a no-op.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
