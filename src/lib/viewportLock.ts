/** Lock page magnification without cancelling piano touches or score double-clicks. */
export function lockAppViewport(target: Window = window) {
  const prevent = (event: Event) => event.preventDefault();
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };
  const key = (event: KeyboardEvent) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      ["+", "=", "-", "_", "0"].includes(event.key)
    )
      event.preventDefault();
  };
  // Safari exposes pinch as gesture events. Do not cancel multi-touch events:
  // two or more fingers still need to reach each individual piano key.
  const gestures = ["gesturestart", "gesturechange", "gestureend"];
  const options = { passive: false, capture: true };
  for (const name of gestures)
    target.addEventListener(name, prevent, options);
  target.addEventListener("wheel", wheel, options);
  target.addEventListener("keydown", key, options);
  return () => {
    for (const name of gestures)
      target.removeEventListener(name, prevent, options);
    target.removeEventListener("wheel", wheel, options);
    target.removeEventListener("keydown", key, options);
  };
}
