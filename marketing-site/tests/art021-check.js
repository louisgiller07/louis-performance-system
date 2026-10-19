// ART-02.1 — production visual validation of the marketing site, runnable in
// Chromium, Firefox and WebKit (Playwright). Run through the multi-engine
// runner (scratch xbrowser/run.mjs) or the Playwright MCP plugin against:
//   npx astro dev --host 127.0.0.1 --port 4395   (or globalThis.__NALYNT_BASE)
// Optional: globalThis.__AXE_SOURCE (axe-core source) enables the axe audit.
// The contact form is only ever submitted against a mocked /api/contact.
// Returns { engine, total, passed, failed, notes }.
async (page) => {
  const BASE = globalThis.__NALYNT_BASE ?? "http://127.0.0.1:4395";
  const AXE = globalThis.__AXE_SOURCE;
  const ROUTES = ["/", "/coaching", "/comment-ca-marche", "/philosophie", "/a-propos", "/contact", "/confidentialite"];
  const APP_LINKS = ["https://app.nalynt.ch/signup", "https://app.nalynt.ch/login", "https://app.nalynt.ch/privacy"];
  const browser = page.context().browser();
  const engine = browser.browserType().name();
  const checks = [];
  const notes = {};
  const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  const errors = [];
  const watch = (p) => {
    p.on("pageerror", (e) => errors.push(`${p.url()} ${e.message}`));
    // Expected logs: the contact form's own report of the mocked 400, and the browser's matching network line.
    p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource|contact form submission failed/.test(m.text()) && errors.push(m.text()));
  };
  const newPage = async (options = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    const p = await ctx.newPage();
    watch(p);
    return [ctx, p];
  };
  const goTo = (p, sel, off = 90) =>
    p.evaluate(([s, o]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + window.scrollY - o), [sel, off]);
  const revealAll = async (p) => {
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += 300) {
      await p.evaluate((v) => window.scrollTo(0, v), y);
      await p.waitForTimeout(60);
    }
    await p.waitForTimeout(3600);
  };
  const demoState = (p) =>
    p.evaluate(() => {
      const c = document.querySelector("[data-console]");
      const blocks = [...document.querySelectorAll("[data-block]")].map((b) => {
        const l = b.querySelector("[data-block-label]").getBoundingClientRect();
        const t = b.querySelector("[data-block-time]").getBoundingClientRect();
        return Math.round(t.left - l.right);
      });
      return {
        h: c.offsetHeight,
        duration: document.querySelector("[data-duration]").textContent.trim(),
        times: [...document.querySelectorAll("[data-block-time]")].map((t) => t.textContent.trim()),
        minGap: Math.min(...blocks),
        tag: document.querySelector(".console-tag").textContent.trim(),
      };
    });
  const EXPECT = { fresh: ["4 h", ["30 min", "2 h 50", "40 min"]], tired: ["2 h 30", ["20 min", "1 h 50", "20 min"]], busy: ["4 h", ["40 min", "2 h 40", "40 min"]] };

  // ============ Demo: six transitions both ways, desktop and mobile ============
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const [ctx, p] = await newPage({ viewport: { width: w, height: h } });
    await p.goto(BASE + "/");
    await p.waitForTimeout(600);
    await goTo(p, "[data-console]", w < 960 ? 80 : 110);
    await p.waitForTimeout(500);
    const baseH = (await demoState(p)).h;
    const order = ["fresh", "tired", "busy", "tired", "fresh", "busy", "fresh"];
    let maxDrift = 0;
    for (const id of order) {
      await p.locator(`[data-scenario="${id}"]`).click();
      for (let i = 0; i < 16; i++) {
        await p.waitForTimeout(60);
        const s = await demoState(p);
        maxDrift = Math.max(maxDrift, Math.abs(s.h - baseH));
        if (s.minGap < 12) check(`${w}px demo ${id}: label/time gap during transition`, false, s.minGap);
      }
      await p.waitForTimeout(500);
      const s = await demoState(p);
      check(`${w}px demo -> ${id}: duration and block times`, s.duration === EXPECT[id][0] && s.times.join("|") === EXPECT[id][1].join("|"), `${s.duration} ${s.times.join("|")}`);
      check(`${w}px demo -> ${id}: "Exemple fictif" always shown`, s.tag === "Exemple fictif");
    }
    check(`${w}px demo: height stable during every transition`, maxDrift === 0, `${maxDrift}px`);
    // The rider dot rides the route (never stuck at the SVG origin, the Firefox SMIL defect).
    await p.locator('[data-scenario="busy"]').click();
    await p.waitForTimeout(1150);
    const dot = await p.evaluate(() => {
      const c = document.querySelector("[data-route-rider]");
      return { x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")), shown: document.querySelector("[data-console]").classList.contains("is-riding") };
    });
    check(`${w}px demo: rider dot on the route while riding`, !dot.shown || (dot.x > 8 && dot.y > 5 && dot.y < 80), JSON.stringify(dot));
    await p.waitForTimeout(700);
    for (const id of ["busy", "fresh", "tired", "busy", "tired", "fresh", "busy"]) await p.locator(`[data-scenario="${id}"]`).click({ delay: 0 });
    await p.waitForTimeout(1400);
    const r = await demoState(p);
    check(`${w}px demo: rapid clicks settle on the last choice`, r.duration === EXPECT.busy[0] && r.times.join("|") === EXPECT.busy[1].join("|"), r.duration);
    check(`${w}px demo: no wording suggesting a live engine call`, !/ajustement…|calcul en cours|connexion/i.test(await p.locator("[data-console]").innerText()));
    await ctx.close();
  }

  // ============ Hero (mobile 375 x 667 and 390, tablet 768, desktop) ============
  for (const [w, h] of [[375, 667], [390, 844], [768, 1024], [1440, 900]]) {
    const [ctx, p] = await newPage({ viewport: { width: w, height: h } });
    await p.goto(BASE + "/");
    await p.waitForTimeout(800);
    const early = await p.evaluate(() => {
      const b = document.querySelector(".hero-actions .btn-gold").getBoundingClientRect();
      return { bottom: b.bottom, vh: innerHeight, opacity: getComputedStyle(document.querySelector(".hero-actions")).opacity };
    });
    check(`${w}px hero: CTA in the first screen and usable early (0.8 s)`, early.bottom <= early.vh && Number(early.opacity) > 0.5, JSON.stringify(early));
    await p.waitForTimeout(2400);
    const m = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const change = r(".story-label-change");
      const goal = r(".story-label-goal");
      const title = r(".hero-title");
      const lead = r(".hero-lead");
      const fs = parseFloat(getComputedStyle(document.querySelector(".story-label")).fontSize);
      const media = r("[data-hero-media]");
      return { inside: change.left >= 0 && goal.right <= vw, noLabelOnTitle: change.top >= title.bottom - 2, noLabelOnLead: goal.bottom <= lead.top + 2, fs, titleBelowPhotoCenter: vw < 960 ? title.top > media.top + media.height * 0.6 : true };
    });
    check(`${w}px hero: line labels inside the screen`, m.inside, JSON.stringify(m));
    check(`${w}px hero: line labels clear of title and lead`, m.noLabelOnTitle && m.noLabelOnLead, JSON.stringify(m));
    check(`${w}px hero: line labels >= 13px`, m.fs >= 13, m.fs);
    check(`${w}px hero: title clear of the rider (mobile band)`, m.titleBelowPhotoCenter);
    await ctx.close();
  }

  // ============ Every page: content, links, overflow, axe ============
  const internal = new Set();
  for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1440, 900]]) {
    const [ctx, p] = await newPage({ viewport: { width: w, height: h } });
    for (const route of ROUTES) {
      const res = await p.goto(BASE + route);
      await p.waitForTimeout(250);
      if (w === 1440) {
        check(`${route}: 200`, res.status() === 200, res.status());
        const body = await p.locator("body").innerText();
        check(`${route}: no price / free / beta / enduro wording`, !/gratuit|bêta|\bbeta\b|paiement|prix|€|CHF|enduro|gravity/i.test(body));
        // ART-RELEASE-01 publication gate: a privacy fact still « À CONFIRMER » blocks the release.
        check(`${route}: no fact left « À CONFIRMER » (publication gate)`, !/À CONFIRMER/.test(body));
        check(`${route}: one h1, no all-caps headings`, (await p.locator("h1").count()) === 1 && (await p.$$eval("h1,h2,h3", (els) => els.filter((e) => getComputedStyle(e).textTransform === "uppercase").length)) === 0);
        const hrefs = await p.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
        hrefs.filter((x) => x.startsWith("/")).forEach((x) => internal.add(x.split("#")[0] || "/"));
        check(`${route}: app links only /signup, /login and /privacy`, hrefs.filter((x) => /^https?:/.test(x)).every((x) => APP_LINKS.includes(x)));
        check(`${route}: images have alt`, (await p.$$eval("img", (i) => i.filter((x) => !x.getAttribute("alt")).length)) === 0);
      }
      const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${w}px ${route}: no horizontal overflow`, o === 0, o);
      if (AXE && engine === "chromium" && (w === 1440 || w === 390)) {
        await revealAll(p);
        // Back to the top: the hero copy is meant to dim only once scrolled away.
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(400);
        await p.addScriptTag({ content: AXE });
        const result = await p.evaluate(async () => {
          const r = await window.axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        });
        const serious = result.filter((v) => v.impact === "serious" || v.impact === "critical");
        check(`axe ${w}px ${route}: no serious/critical violation`, serious.length === 0, JSON.stringify(serious));
        if (result.length) notes[`axe ${w}px ${route}`] = result;
      }
    }
    await ctx.close();
  }
  {
    const [ctx, p] = await newPage();
    for (const href of internal) {
      const r = await p.request.get(BASE + href);
      check(`link ${href} answers 200`, r.status() === 200, r.status());
    }
    await ctx.close();
  }

  // ============ Keyboard: every focus stop visible, tabs, menu ============
  {
    const [ctx, p] = await newPage();
    // WebKit follows Safari's default: Tab only reaches form controls and buttons (links need
    // "Full Keyboard Access"). There, every stop reached must still show its focus.
    const tabKey = "Tab";
    for (const route of ["/", "/comment-ca-marche", "/contact"]) {
      await p.goto(BASE + route);
      await p.waitForTimeout(400);
      const seen = [];
      let invisible = 0;
      for (let i = 0; i < 70; i++) {
        await p.keyboard.press(tabKey);
        const f = await p.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const visible = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
          return { tag: el.tagName, text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24), visible, onScreen: r.width > 0 && r.height > 0 };
        });
        if (!f) break;
        seen.push(f.text);
        if (!f.visible || !f.onScreen) invisible++;
      }
      check(`keyboard ${route}: every focus stop is visible`, invisible === 0 && seen.length > (engine === "webkit" ? 1 : 5), `${invisible} / ${seen.length}`);
      if (route === "/" && engine !== "webkit") check("keyboard /: skip link first", seen[0] === "Aller au contenu", seen[0]);
      if (engine === "webkit") notes[`webkit tab stops ${route}`] = seen.length;
    }
    await p.goto(BASE + "/");
    await p.locator("#tab-week").focus();
    await p.keyboard.press("ArrowRight");
    check("keyboard demo tabs: arrows move selection and focus", (await p.locator("#tab-history").getAttribute("aria-selected")) === "true" && (await p.evaluate(() => document.activeElement?.id)) === "tab-history");
    await p.locator("#coaching-tab-technique").focus();
    await p.keyboard.press("End");
    check("keyboard domains: End selects Progression", (await p.locator("#coaching-tab-progression").getAttribute("aria-selected")) === "true");
    await p.locator('[data-scenario="busy"]').focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1200);
    check("keyboard demo: Enter on a scenario", (await p.locator("[data-duration]").innerText()) === EXPECT.busy[0] && (await p.locator("[data-console]").innerText()).includes("Nuit courte"));
    await p.goto(BASE + "/comment-ca-marche");
    await p.locator('[data-decision="replace"]').focus();
    check("keyboard decisions: focus selects the decision", (await p.locator('[data-decision="replace"]').getAttribute("aria-pressed")) === "true");
    await ctx.close();
  }

  // ============ Touch (390, hasTouch) ============
  {
    const [ctx, p] = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine !== "firefox" });
    await p.goto(BASE + "/");
    await p.waitForTimeout(500);
    await p.locator("[data-menu-button]").tap();
    check("touch: menu opens", (await p.locator("[data-menu-button]").getAttribute("aria-expanded")) === "true");
    await p.locator("[data-menu-button]").tap();
    await goTo(p, "#demo", 80);
    await p.locator('[data-scenario="fresh"]').tap();
    await p.waitForTimeout(1300);
    check("touch: scenario tap", (await p.locator("[data-duration]").innerText()) === "4 h");
    await goTo(p, "#coaching .domains-body", 80);
    await p.locator("#coaching-tab-nutrition").tap();
    await p.waitForTimeout(600);
    check("touch: domain chip tap", (await p.locator('#coaching [data-domain-field="name"]').innerText()) === "Nutrition et hydratation");
    const small = await p.$$eval(".picker-option, [role=tab], .station, summary, .btn-gold, .start-link, [data-menu-button], [data-board-replay], .dc-item", (els) =>
      els.filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length,
    );
    check("touch: targets >= 44px", small === 0, small);
    await p.goto(BASE + "/comment-ca-marche");
    await goTo(p, "#decisions", 80);
    await p.locator('[data-decision="keep"]').tap();
    await p.waitForTimeout(800);
    check("touch: decision tap", (await p.locator('[data-decision="keep"]').getAttribute("aria-pressed")) === "true");
    await ctx.close();
  }

  // ============ Forms (contact, mocked API) ============
  {
    const [ctx, p] = await newPage();
    let calls = 0;
    await p.route("**/api/contact", async (route) => {
      calls++;
      const body = route.request().postDataJSON();
      const ok = body && body.name && body.email && body.subject && body.message;
      await route.fulfill({ status: ok ? 200 : 400, contentType: "application/json", body: JSON.stringify(ok ? { ok: true } : { error: "invalid_fields" }) });
    });
    await p.goto(BASE + "/contact");
    await p.click("#contact-form-submit");
    await p.waitForTimeout(500);
    check("form: empty submit shows the error message", /erreur/i.test(await p.locator("#contact-form-status").innerText()));
    await p.fill("#name", "Test");
    await p.fill("#email", "test@example.com");
    await p.fill("#subject", "Essai");
    await p.fill("#message", "Message de test (API simulée).");
    await p.click("#contact-form-submit");
    await p.waitForTimeout(600);
    check("form: valid submit shows success and resets", /merci/i.test(await p.locator("#contact-form-status").innerText()) && (await p.inputValue("#name")) === "");
    check("form: never reached the real API (mocked)", calls === 2, calls);
    await ctx.close();
  }

  // ============ Reduced motion ============
  {
    const [ctx, p] = await newPage({ reducedMotion: "reduce" });
    await p.goto(BASE + "/");
    await p.waitForTimeout(300);
    check("reduced: no hero animation", (await p.locator(".hero-line > span").first().evaluate((e) => getComputedStyle(e).animationName)) === "none");
    await goTo(p, ".board", 120);
    await p.waitForTimeout(300);
    check("reduced: week complete", (await p.locator(".board").evaluate((e) => e.classList.contains("is-done"))) && (await p.locator(".board .session").first().evaluate((e) => getComputedStyle(e).opacity)) === "1");
    await goTo(p, "[data-console]", 110);
    await p.locator('[data-scenario="busy"]').click();
    check("reduced: demo instant", (await p.locator("[data-duration]").innerText()) === EXPECT.busy[0] && (await p.locator("[data-console]").innerText()).includes("Nuit courte"));
    check("reduced: convergence complete", (await p.locator("#courses .cv-ring").evaluate((e) => getComputedStyle(e).opacity)) === "1");
    await p.goto(BASE + "/comment-ca-marche");
    await goTo(p, "#boucle", 80);
    await p.waitForTimeout(300);
    check("reduced: loop screens visible", (await p.locator(".screen").first().evaluate((e) => getComputedStyle(e).opacity)) === "1");
    await p.goto(BASE + "/a-propos");
    await goTo(p, ".ab-map", 120);
    await p.waitForTimeout(300);
    check("reduced: reality map drawn", ["0", "0px"].includes(await p.locator(".ab-real").evaluate((e) => getComputedStyle(e).strokeDashoffset)));
    await ctx.close();
  }

  // ============ No JavaScript: content, navigation ============
  {
    const [ctx, p] = await newPage({ javaScriptEnabled: false });
    for (const route of ROUTES) {
      await p.goto(BASE + route);
      // CSS-only openings still play without JS: measure once they have ended.
      await p.waitForTimeout(3000);
      const hidden = await p.evaluate(() => [...document.querySelectorAll("main h1, main h2, main h3, main p")].filter((e) => parseFloat(getComputedStyle(e).opacity) < 1 && e.offsetParent !== null).length);
      check(`no JS ${route}: all text visible`, hidden === 0, hidden);
    }
    await p.goto(BASE + "/");
    check("no JS: demo rendered", (await p.locator("[data-duration]").innerText()) === "2 h 30");
    const navLinks = await p.$$eval("footer a[href^='/']", (as) => as.map((a) => a.getAttribute("href")));
    check("no JS: every inner page reachable from the footer", ["/coaching", "/comment-ca-marche", "/philosophie", "/a-propos", "/contact"].every((x) => navLinks.includes(x)));
    await ctx.close();
  }

  // ============ Smoothness: longest frame during the opening and a demo change ============
  {
    const [ctx, p] = await newPage();
    await p.addInitScript(() => {
      window.__frames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (window.__frames.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await p.goto(BASE + "/");
    await p.waitForTimeout(3000);
    const opening = await p.evaluate(() => window.__frames.slice(5));
    await goTo(p, "[data-console]", 110);
    await p.waitForTimeout(400);
    const demo = await p.evaluate(async () => {
      const frames = [];
      let last = performance.now();
      let run = true;
      const tick = (t) => {
        frames.push(t - last);
        last = t;
        if (run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.querySelector('[data-scenario="fresh"]').click();
      await new Promise((r) => setTimeout(r, 1200));
      run = false;
      return frames.slice(2);
    });
    const stat = (f) => ({ frames: f.length, worstMs: Math.round(Math.max(...f)), over50: f.filter((x) => x > 50).length });
    notes.smoothness = { opening: stat(opening), demoChange: stat(demo) };
    check("smooth: demo change has no frame over 100 ms", stat(demo).worstMs <= 100, JSON.stringify(stat(demo)));
    await ctx.close();
  }

  check("no console / page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  return { engine, total: checks.length, passed: checks.length - failed.length, failed, notes };
}
