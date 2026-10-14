// ART-02 — shared motion core for every page (imported by BaseLayout and by
// the component scripts; bundled once). No animation library: CSS and the Web
// Animations API animate transform / opacity, this module only coordinates.
//   - reveals: [data-rise], [data-fade], [data-reveal] get .is-in on entering;
//   - one rAF scroll loop, each task running only while its element is near
//     the viewport;
//   - an interruptible numeric tween (always starts from the current value).
// Under prefers-reduced-motion scroll-linked tasks are not registered (their
// elements show their final state in CSS) and tweens jump to the end.

export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
export const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// --- Reveals ---
const revealTargets = document.querySelectorAll<HTMLElement>("[data-rise], [data-fade], [data-reveal]");
if (!("IntersectionObserver" in window)) {
  revealTargets.forEach((el) => el.classList.add("is-in"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  revealTargets.forEach((el) => observer.observe(el));
}

// --- One scroll loop ---
type FrameTask = { el: Element; visible: boolean; run: () => void };
const tasks: FrameTask[] = [];
let queued = false;
const frame = () => {
  queued = false;
  for (const task of tasks) if (task.visible) task.run();
};
export const requestFrame = () => {
  if (!queued) {
    queued = true;
    requestAnimationFrame(frame);
  }
};
const visibility = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) for (const task of tasks) if (task.el === entry.target) task.visible = entry.isIntersecting;
    requestFrame();
  },
  { rootMargin: "25% 0px" },
);
/** Runs `run` on every scroll / resize frame while `el` is near the viewport (never under reduced motion). */
export function onScrollFrame(el: Element, run: () => void): void {
  if (reduced.matches) return;
  tasks.push({ el, visible: false, run });
  visibility.observe(el);
}
window.addEventListener("scroll", requestFrame, { passive: true });
window.addEventListener("resize", requestFrame, { passive: true });

/** Progress of `el` crossing the viewport: 0 when its top reaches `start` (fraction of vh), 1 after `span` vh more. */
export function progressThrough(el: Element, start = 0.85, span = 0.6): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return clamp01((vh * start - rect.top) / (vh * span));
}

/** Calls `onVisible` once when `el` is at least `threshold` visible. */
export function whenVisible(el: Element, onVisible: () => void, threshold = 0.35): void {
  if (!("IntersectionObserver" in window)) {
    onVisible();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        onVisible();
      }
    },
    { threshold },
  );
  observer.observe(el);
}

/** Re-plays a CSS state class (removes, reflows, adds). */
export function replay(el: HTMLElement, className = "is-changing"): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/**
 * Interruptible tween of a number. Returns a handle whose `to()` retargets from
 * the value currently shown, so rapid changes never jump or stack.
 */
export function numberTween(initial: number, render: (value: number) => void, duration = 650, ease = easeOutCubic) {
  let current = initial;
  let raf = 0;
  return {
    get value() {
      return current;
    },
    to(target: number) {
      cancelAnimationFrame(raf);
      const from = current;
      if (reduced.matches || from === target) {
        current = target;
        render(target);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        current = t < 1 ? from + (target - from) * ease(t) : target;
        render(current);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
  };
}

/** Numbers of an SVG path `d` (all scenario routes share one command structure). */
export const pathNumbers = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
/** Rebuilds `template`'s commands around `numbers`. */
export function pathFrom(template: string, numbers: number[]): string {
  let i = 0;
  return template.replace(/-?\d*\.?\d+/g, () => numbers[i++]!.toFixed(1));
}

// --- Generic scroll-linked hooks (registered once for every page) ---
// [data-parallax="0.1"]: the element drifts slower than its parent section.
document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((media) => {
  const factor = Number(media.dataset.parallax) || 0.1;
  const host = media.parentElement ?? media;
  onScrollFrame(host, () => {
    const rect = host.getBoundingClientRect();
    const offset = rect.top + rect.height / 2 - window.innerHeight / 2;
    media.style.setProperty("--py", `${(-offset * factor).toFixed(1)}px`);
  });
});
// [data-progress-host]: --progress (0..1) while the section crosses the screen.
document.querySelectorAll<HTMLElement>("[data-progress-host]").forEach((host) => {
  const start = Number(host.dataset.progressStart) || 0.85;
  const span = Number(host.dataset.progressSpan) || 0.6;
  onScrollFrame(host, () => host.style.setProperty("--progress", progressThrough(host, start, span).toFixed(4)));
});

/**
 * Moves an SVG circle along a path (getPointAtLength), the same in every engine
 * (SMIL animateMotion restarted from script is not applied by Firefox). Never runs
 * under reduced motion. Returns a cancel function.
 */
export function rideAlong(dot: SVGCircleElement, path: SVGPathElement, duration: number, delay = 0, ease = easeInOut): () => void {
  if (reduced.matches) return () => {};
  let raf = 0;
  let timer = 0;
  const length = path.getTotalLength();
  const start = () => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const point = path.getPointAtLength(length * ease(t));
      dot.setAttribute("cx", point.x.toFixed(2));
      dot.setAttribute("cy", point.y.toFixed(2));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  timer = window.setTimeout(start, delay);
  return () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(raf);
  };
}
