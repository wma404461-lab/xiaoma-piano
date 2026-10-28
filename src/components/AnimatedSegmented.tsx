import { useLayoutEffect, useRef, type HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { value: string };

/** Keep the existing buttons and handlers; only the decorative pill moves. */
export function AnimatedSegmented({
  value,
  className = "",
  children,
  ...props
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selected = useRef(value);
  selected.current = value;
  const measure = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0;
    let previous = "";
    const update = () => {
      frame = 0;
      const button = Array.from(
        element.querySelectorAll<HTMLButtonElement>(
          ":scope > button[data-segment-id]",
        ),
      ).find((node) => node.dataset.segmentId === selected.current);
      if (!button || !button.offsetWidth || !button.offsetHeight) {
        element.dataset.segmentReady = "false";
        previous = "";
        return;
      }
      const values = [
        button.offsetLeft,
        button.offsetTop,
        button.offsetWidth,
        button.offsetHeight,
      ];
      const key = values.join(":");
      if (key === previous) return;
      previous = key;
      ["x", "y", "width", "height"].forEach((name, index) =>
        element.style.setProperty(`--segment-${name}`, `${values[index]}px`),
      );
      element.dataset.segmentReady = "true";
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    measure.current = update;
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(element);
    element
      .querySelectorAll("button[data-segment-id]")
      .forEach((button) => observer?.observe(button));
    window.addEventListener("resize", schedule);
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      measure.current = () => {};
    };
  }, []);
  useLayoutEffect(() => measure.current(), [value]);
  return (
    <div {...props} ref={host} className={`${className} animated-segmented`}>
      <i className="segment-indicator" aria-hidden="true" />
      {children}
    </div>
  );
}
