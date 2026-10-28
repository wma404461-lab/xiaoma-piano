// Opt-in local profiling; no data leaves the browser and production builds omit the probe.
const enabled =
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("perf");
const counters: Record<string, number> = {};
const timings: Record<
  string,
  { count: number; total: number; max: number; samples: number[] }
> = {};
export function countWork(name: string, amount = 1) {
  if (enabled) counters[name] = (counters[name] ?? 0) + amount;
}
export function measureGauge(name: string, value: number) {
  if (enabled) counters[name] = value;
}
export function timeWork(name: string) {
  if (!enabled) return () => {};
  const start = performance.now();
  return () => recordWork(name, performance.now() - start);
}
export function recordWork(name: string, duration: number) {
  if (!enabled) return;
  const metric = (timings[name] ??= {
    count: 0,
    total: 0,
    max: 0,
    samples: [],
  });
  metric.count++;
  metric.total += duration;
  metric.max = Math.max(metric.max, duration);
  if (metric.samples.length < 2000) metric.samples.push(duration);
}
/** Measure a user action through the next painted, ready view on the local probe. */
export function traceInteraction(name: string, selector: string) {
  if (!enabled) return;
  const start = performance.now();
  let finished = false;
  const observer = new MutationObserver(check);
  const timeout = setTimeout(stop, 30000);
  function stop() {
    finished = true;
    observer.disconnect();
    clearTimeout(timeout);
  }
  function check() {
    if (finished || !document.querySelector(selector)) return;
    stop();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        recordWork(name, performance.now() - start);
        measureGauge(
          "libraryCards",
          document.querySelectorAll(".library-grid .song-card").length,
        );
        measureGauge("domElements", document.querySelectorAll("*").length);
      }),
    );
  }
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  requestAnimationFrame(check);
}
export function startPerformanceProbe() {
  if (!enabled) return;
  const start = performance.now();
  let frames = 0,
    slowFrames = 0,
    previous = start,
    longTasks = 0,
    longTaskMs = 0,
    longestTask = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks++;
      longTaskMs += entry.duration;
      longestTask = Math.max(longestTask, entry.duration);
    }
  });
  if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
    observer.observe({ entryTypes: ["longtask"] });
  const frame = (now: number) => {
    frames++;
    if (now - previous > 50) slowFrames++;
    previous = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(() => {
    const duration = (performance.now() - start) / 1000;
    document.documentElement.dataset.performance = JSON.stringify({
      seconds: +duration.toFixed(1),
      frames,
      fps: +(frames / duration).toFixed(1),
      slowFrames,
      longTasks,
      longTaskMs: +longTaskMs.toFixed(1),
      longestTask,
      counters: { ...counters },
      timings: Object.fromEntries(
        Object.entries(timings).map(([name, metric]) => {
          const sorted = [...metric.samples].sort((a, b) => a - b);
          return [
            name,
            {
              count: metric.count,
              total: +metric.total.toFixed(2),
              max: +metric.max.toFixed(2),
              p95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2),
            },
          ];
        }),
      ),
    });
  }, 1000);
}
