// V3 homepage motion — one small vanilla module, no animation library.
// Everything here only toggles classes / CSS variables (transform & opacity
// are animated by CSS), runs work only while the relevant section is on
// screen, and degrades to the static, fully-visible page when JS is off or
// the visitor prefers reduced motion.

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function onceVisible(selector: string, className: string, rootMargin = "0px 0px -12% 0px"): void {
  const elements = document.querySelectorAll<HTMLElement>(selector);
  if (!("IntersectionObserver" in window)) {
    elements.forEach((el) => el.classList.add(className));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(className);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin },
  );
  elements.forEach((el) => observer.observe(el));
}

/** rAF-throttled scroll/resize loop that only runs while `target` is near the viewport. */
function whileVisible(target: Element, frame: () => void): void {
  let visible = false;
  let queued = false;
  const tick = () => {
    queued = false;
    if (visible) frame();
  };
  const request = () => {
    if (!queued && visible) {
      queued = true;
      requestAnimationFrame(tick);
    }
  };
  new IntersectionObserver(
    ([entry]) => {
      visible = entry!.isIntersecting;
      request();
    },
    { rootMargin: "20% 0px" },
  ).observe(target);
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request, { passive: true });
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// --- Reveal (all sections) + "Le problème" realities (lit at mid-viewport, stay lit) ---
onceVisible("[data-reveal]", "is-in");

function initRealities(): void {
  const items = [...document.querySelectorAll<HTMLElement>("[data-lit]")];
  let litUpTo = -1;
  // Lighting one reality also lights every reality above it, so a fast fling
  // or an anchor jump never leaves an already-passed one dimmed.
  const lightUpTo = (index: number) => {
    for (let i = litUpTo + 1; i <= index; i++) items[i]!.classList.add("is-lit");
    litUpTo = Math.max(litUpTo, index);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = items.indexOf(entry.target as HTMLElement);
        const passed = entry.boundingClientRect.bottom < (entry.rootBounds?.top ?? 0);
        if (entry.isIntersecting || passed) lightUpTo(index);
      }
      if (litUpTo === items.length - 1) observer.disconnect();
    },
    { rootMargin: "-40% 0px -40% 0px" },
  );
  items.forEach((item) => observer.observe(item));
}

// --- 03 Une journée avec NALYNT ---
function initDayStory(): void {
  const section = document.querySelector<HTMLElement>("[data-day]");
  if (!section) return;
  const steps = [...section.querySelectorAll<HTMLElement>("[data-day-step]")];
  const stacked = [...section.querySelectorAll<HTMLElement>(".is-stacked")];
  const stepsBox = section.querySelector<HTMLElement>("[data-day-steps]");

  const activate = (index: number) => {
    steps.forEach((step, i) => step.classList.toggle("is-active", i === index));
    stacked.forEach((panel, i) => panel.classList.toggle("is-active", i === index));
  };
  activate(0);

  // Desktop: the step crossing the middle of the viewport drives the sticky panel.
  const stepObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate(Number((entry.target as HTMLElement).dataset.dayStep));
      }
    },
    { rootMargin: "-50% 0px -50% 0px" },
  );
  steps.forEach((step) => stepObserver.observe(step));

  // Mobile: each inline panel plays its own sequence once it is well in view.
  const inlinePanels = section.querySelectorAll<HTMLElement>("[data-day-inline] .day-panel");
  const inlineObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-active");
        inlineObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -30% 0px" },
  );
  inlinePanels.forEach((panel) => inlineObserver.observe(panel));

  // Gold progress rail along the steps.
  if (stepsBox && !reducedMotion.matches) {
    stepsBox.style.setProperty("--day-progress", "0");
    const rail = section.querySelector<HTMLElement>(".day-rail");
    whileVisible(stepsBox, () => {
      const rect = stepsBox.getBoundingClientRect();
      const progress = clamp01((window.innerHeight / 2 - rect.top) / rect.height);
      rail?.style.setProperty("--day-progress", progress.toFixed(4));
    });
  }
}

// --- Light parallax (transform only) ---
function initParallax(): void {
  if (reducedMotion.matches) return;
  document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
    const factor = Number(el.dataset.parallax) || 0.1;
    const host = el.parentElement ?? el;
    whileVisible(host, () => {
      const rect = host.getBoundingClientRect();
      const offset = rect.top + rect.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${(-offset * factor).toFixed(1)}px, 0)`;
    });
  });
}

// --- Hero dust: a few dozen slow motes, paused off-screen / in background tabs ---
function initDust(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-dust]");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || reducedMotion.matches) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let width = 0;
  let height = 0;
  type Mote = { x: number; y: number; r: number; a: number; vx: number; vy: number; phase: number };
  let motes: Mote[] = [];

  const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = width < 768 ? 26 : 56;
    motes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.5 + Math.random() * 1.4,
      a: 0.05 + Math.random() * 0.22,
      vx: 0.06 + Math.random() * 0.18,
      vy: -(0.04 + Math.random() * 0.12),
      phase: Math.random() * Math.PI * 2,
    }));
  };

  let running = false;
  let last = 0;
  const draw = (now: number) => {
    if (!running) return;
    const dt = Math.min(48, now - (last || now)) / 16.67;
    last = now;
    ctx.clearRect(0, 0, width, height);
    for (const m of motes) {
      m.phase += 0.01 * dt;
      m.x += (m.vx + Math.sin(m.phase) * 0.08) * dt;
      m.y += m.vy * dt;
      if (m.x > width + 4) m.x = -4;
      if (m.y < -4) m.y = height + 4;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(231, 214, 180, ${m.a})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  };
  const setRunning = (next: boolean) => {
    if (next === running) return;
    running = next;
    if (running) {
      last = 0;
      requestAnimationFrame(draw);
    }
  };

  resize();
  window.addEventListener("resize", resize, { passive: true });
  let inView = true;
  new IntersectionObserver(([entry]) => {
    inView = entry!.isIntersecting;
    setRunning(inView && !document.hidden);
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => setRunning(inView && !document.hidden));
}

// --- 05 Product tabs (WAI-ARIA tabs, autoplay until the first interaction) ---
function initProduct(): void {
  const section = document.querySelector<HTMLElement>("[data-product]");
  if (!section) return;
  const tabs = [...section.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const screens = [...section.querySelectorAll<HTMLElement>("[data-screen]")];
  const lines = [...section.querySelectorAll<HTMLElement>("[data-line]")];
  const CYCLE_MS = 6500;
  let current = 0;
  let timer: number | undefined;
  let userTookOver = reducedMotion.matches;

  const select = (index: number, focus = false) => {
    current = (index + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      const selected = i === current;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    screens.forEach((screen, i) => screen.classList.toggle("is-active", i === current));
    lines.forEach((line, i) => (line.hidden = i !== current));
    if (focus) tabs[current]!.focus();
  };

  const stopAutoplay = () => {
    window.clearInterval(timer);
    timer = undefined;
    section.classList.remove("is-autoplay");
  };
  const startAutoplay = () => {
    if (userTookOver || timer !== undefined) return;
    section.style.setProperty("--cycle", `${CYCLE_MS}ms`);
    section.classList.add("is-autoplay");
    timer = window.setInterval(() => select(current + 1), CYCLE_MS);
  };
  const takeOver = () => {
    userTookOver = true;
    stopAutoplay();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      takeOver();
      select(i);
    });
    tab.addEventListener("keydown", (event) => {
      const moves: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      let next: number | undefined;
      if (event.key in moves) next = current + moves[event.key]!;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      takeOver();
      select(next, true);
    });
  });

  new IntersectionObserver(
    ([entry]) => {
      if (entry!.isIntersecting) startAutoplay();
      else stopAutoplay();
    },
    { rootMargin: "-25% 0px -25% 0px" },
  ).observe(section);
}

initRealities();
initDayStory();
initParallax();
initDust();
initProduct();
