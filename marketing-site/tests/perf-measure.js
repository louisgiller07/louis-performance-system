// ART-01 / ART-02 — performance measurement of the BUILT homepage (not the dev server).
// Serve the built `.vercel/output/static` of ART-01 on 127.0.0.1:4394, ART-02 on
// 4392 and ART-02.1 on 4396 (gzip, like a CDN); then run this file in
// the Playwright MCP plugin (browser_run_code_unsafe, `filename`). Chromium only.
// Unreachable targets are skipped.
// Profiles: mobile (390 px, CPU x4, 1.6 Mbps / 150 ms RTT, like Lighthouse
// "slow 4G") and desktop (1440 px, no throttling). Cold cache each run.
// Reported: FCP, LCP (+ element), CLS, long tasks total blocking time (TBT
// approximation from Long Tasks > 50 ms until load + 5 s), transferred bytes
// by type, and frame rate while scrolling the whole page.
async (page) => {
  const run = async (URL, profile) => {
    const ctx = await page.context().browser().newContext({ viewport: profile.viewport, deviceScaleFactor: profile.dpr });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (profile.throttle) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await p.addInitScript(() => {
      window.__perf = { lcp: 0, lcpEl: "", cls: 0, tbt: 0, longTasks: 0 };
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__perf.lcp = e.startTime;
          window.__perf.lcpEl = e.element ? e.element.tagName + "." + String(e.element.className).split(" ")[0] : e.url;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__perf.longTasks += 1;
          window.__perf.tbt += Math.max(0, e.duration - 50);
        }
      }).observe({ type: "longtask", buffered: true });
    });
    await p.goto(URL, { waitUntil: "load" });
    await p.waitForTimeout(5000);
    const vitals = await p.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
      const nav = performance.getEntriesByType("navigation")[0];
      const bytes = {};
      for (const r of performance.getEntriesByType("resource")) {
        const ext = (r.name.split("?")[0].split(".").pop() || "other").toLowerCase();
        bytes[ext] = (bytes[ext] || 0) + (r.transferSize || 0);
      }
      bytes.html = nav.transferSize;
      return { ...window.__perf, fcp, load: nav.loadEventEnd, bytes };
    });
    // Smoothness while scrolling the page (frames counted by rAF).
    const fps = await p.evaluate(async () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      let frames = 0;
      let worst = 0;
      let last = performance.now();
      let running = true;
      const tick = (t) => {
        frames++;
        worst = Math.max(worst, t - last);
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const start = performance.now();
      for (let y = 0; y <= h; y += 40) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
      running = false;
      const seconds = (performance.now() - start) / 1000;
      return { avgFps: Math.round(frames / seconds), worstFrameMs: Math.round(worst) };
    });
    await ctx.close();
    const kb = (n) => Math.round(n / 1024);
    return {
      profile: profile.name,
      FCP_ms: Math.round(vitals.fcp),
      LCP_ms: Math.round(vitals.lcp),
      LCP_element: vitals.lcpEl,
      CLS: Number(vitals.cls.toFixed(4)),
      TBT_ms_approx: Math.round(vitals.tbt),
      longTasks: vitals.longTasks,
      load_ms: Math.round(vitals.load),
      transferred_kB: Object.fromEntries(Object.entries(vitals.bytes).map(([k, v]) => [k, kb(v)])),
      scroll: fps,
    };
  };
  const targets = [
    { name: "ART-01", url: "http://127.0.0.1:4394/" },
    { name: "ART-02", url: "http://127.0.0.1:4392/" },
    { name: "ART-02.1", url: "http://127.0.0.1:4396/" },
  ];
  const results = {};
  for (const target of targets) {
    const ok = await page.request.get(target.url).then((r) => r.ok()).catch(() => false);
    if (!ok) continue;
    results[target.name] = {
      mobile: await run(target.url, { name: "mobile 390, CPU x4, 1.6 Mbps / 150 ms", viewport: { width: 390, height: 844 }, dpr: 3, throttle: true }),
      desktop: await run(target.url, { name: "desktop 1440, no throttling", viewport: { width: 1440, height: 900 }, dpr: 1, throttle: false }),
    };
  }
  return results;
}
