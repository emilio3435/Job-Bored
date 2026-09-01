/* ============================================
   The one celebration (ONE-FLOW-ONBOARDING-SPEC §5 B6, §7).

   The teardown counted FOUR confetti bursts before the user's first job.
   The spec collapses them to ONE, at B6, with the payoff attached — but
   the player itself is the best-tested piece of the old onboarding: a
   persistent CTA handoff (never a timed intermission), the
   reveal-under-the-fade that keeps the dashboard from blinking between
   chapters, and the `inert` click-through fix that made the CTA
   clickable over an overflow:auto wizard in Chromium.

   So the player MOVED rather than got rewritten. It lived in
   onboarding-wizard.js:137-344; L7 deleted that file, and the flow's
   single celebration did not go with it. Its four legacy stages, its
   delegating alias, and every caller but B6 went with the wizard — one
   stage remains, because there is one payoff.

   Behavior is unchanged. Two additions, both for B6:
     · the stage table is `flow_payoff` alone, the flow finale,
     · per-call title/sub/cta overrides, because "You're live, {firstName}."
       is resolved by B6 from the Google session — the player renders what
       it is handed and never owns the user's name.

   Classic-global IIFE under window.JobBoredOnboardingCelebration.
   ============================================ */
(function () {
  const root =
    window.JobBoredOnboardingCelebration ||
    (window.JobBoredOnboardingCelebration = {});

  // Confetti burst — a handful of mint/amber/violet pieces with randomized
  // start, drift, and spin. Pure decoration (aria-hidden); cleared when the
  // overlay hides.
  function spawnCelebrationConfetti(host) {
    if (!host || typeof host.appendChild !== "function") return;
    const colors = ["#5FCB8E", "#EF8F26", "#7C3AED", "#5BB5C9", "#FCEFA8"];
    for (let i = 0; i < 28; i += 1) {
      const piece = document.createElement("span");
      piece.className = "onboarding-celebration__confetti-piece";
      const left = Math.round((i / 28) * 100);
      const delay = (i % 7) * 60;
      const drift = ((i % 5) - 2) * 14;
      piece.style.left = `${left}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${delay}ms`;
      piece.style.setProperty("--drift", `${drift}px`);
      host.appendChild(piece);
    }
  }

  // The flow finale, and nothing else (spec §7): the four legacy stage
  // configs — profile / discovery / devices / bonus — were four "done"
  // moments before a single job existed, and they left with their callers.
  //
  // currentIndex 4 sits past the last journey step, so every step renders
  // done and none renders current — which is the truth at B6: nothing is
  // next, the deal is finished.
  const STAGE_CELEBRATIONS = {
    flow_payoff: {
      title: "You're live.",
      sub: "That was the one-time part. From here, JobBored works for you.",
      cta: "See what happens now →",
      currentIndex: 4,
    },
  };

  function applyCelebrationStage(overlay, stageKey, overrides) {
    const stage =
      STAGE_CELEBRATIONS[stageKey] || STAGE_CELEBRATIONS.flow_payoff;
    const o = overrides || {};
    const pick = (key) => {
      const supplied = o[key];
      return typeof supplied === "string" && supplied.trim()
        ? supplied
        : stage[key];
    };
    const title = document.getElementById("onboardingCelebrationTitle");
    if (title) title.textContent = pick("title");
    const sub = document.getElementById("onboardingCelebrationSub");
    if (sub) sub.textContent = pick("sub");
    const cta = document.getElementById("onboardingCelebrationContinue");
    if (cta) cta.textContent = pick("cta");
    if (overlay && typeof overlay.querySelectorAll === "function") {
      const steps = overlay.querySelectorAll(
        ".onboarding-celebration__journey-step",
      );
      Array.from(steps || []).forEach((li, idx) => {
        if (!li || !li.classList) return;
        li.classList.toggle(
          "onboarding-celebration__journey-step--done",
          idx < stage.currentIndex,
        );
        li.classList.toggle(
          "onboarding-celebration__journey-step--current",
          idx === stage.currentIndex,
        );
        if (idx === stage.currentIndex) {
          li.setAttribute("aria-current", "step");
        } else if (typeof li.removeAttribute === "function") {
          li.removeAttribute("aria-current");
        }
        const dot =
          typeof li.querySelector === "function"
            ? li.querySelector(".onboarding-celebration__journey-dot")
            : null;
        if (dot) {
          dot.textContent = idx < stage.currentIndex ? "✓" : String(idx + 1);
        }
      });
    }
  }

  // Play the celebration. PERSISTENT: the overlay stays up until the user
  // clicks the continue CTA, which fades it out and then runs onDone (the
  // next chapter) — one continuous setup flow, no timed intermission.
  // Degrades gracefully: missing overlay → immediate onDone; overlay
  // without the CTA (stale cached markup) → the old timed dismissal, so
  // the handoff can never strand.
  function playOnboardingCelebration(onDone, stageKey, opts) {
    const options = opts || {};
    const finishCb = typeof onDone === "function" ? onDone : () => {};
    // Which callback the dismiss hands off to — the alt link swaps it.
    let handoff = finishCb;
    let dismissRef = () => {};
    const overlay = document.getElementById("onboardingCelebration");
    if (!overlay) {
      finishCb();
      return;
    }
    applyCelebrationStage(overlay, stageKey || "discovery", options);
    // Optional alternate path (e.g. first-run's "start with your other
    // devices") — rendered as a quiet link under the CTA.
    const altBtn = document.getElementById("onboardingCelebrationAlt");
    if (altBtn) {
      if (typeof options.onAlt === "function") {
        altBtn.hidden = false;
        altBtn.addEventListener(
          "click",
          () => {
            handoff = options.onAlt;
            dismissRef();
          },
          { once: true },
        );
      } else {
        altBtn.hidden = true;
      }
    }
    const burst = document.getElementById("onboardingCelebrationConfetti");
    if (burst) {
      if (typeof burst.replaceChildren === "function") burst.replaceChildren();
      spawnCelebrationConfetti(burst);
    }
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("onboarding-celebration--out");
    overlay.classList.add("onboarding-celebration--in");
    // The first-run + onboarding wizards' focus-trap inerts EVERY body
    // sibling on show — including this celebration overlay — so the
    // overlay arrives inert and intercepts no clicks (CTA appears dead;
    // synthetic .click() and keyboard Enter still work because they bypass
    // hit-testing on the focused button). Un-inert the overlay AND inert
    // every other body sibling so the background can't steal pointer
    // events. Both decisions get restored at dismiss.
    let wasInert = false;
    const inertTargets = [];
    try {
      if (overlay.hasAttribute("inert")) {
        overlay.removeAttribute("inert");
        wasInert = true;
      }
      const body = document.body;
      if (body && body.children) {
        for (const sibling of Array.from(body.children)) {
          if (
            !sibling ||
            sibling === overlay ||
            sibling.hasAttribute("inert")
          ) {
            continue;
          }
          sibling.setAttribute("inert", "");
          inertTargets.push(sibling);
        }
      }
    } catch (_) {
      /* DOM might be sparse in tests; best-effort */
    }
    let finished = false;
    const dismiss = () => {
      if (finished) return;
      finished = true;
      overlay.classList.add("onboarding-celebration--out");
      // Reveal-under-the-fade: open the next chapter at fade START so it
      // mounts beneath the overlay (celebration z-index sits above every
      // wizard) and is revealed as the fade clears — the user never sees
      // the dashboard blink between stages.
      try {
        handoff();
      } catch (err) {
        console.warn("[JobBored] celebration handoff:", err);
      }
      setTimeout(() => {
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        overlay.classList.remove("onboarding-celebration--in");
        overlay.classList.remove("onboarding-celebration--out");
        if (burst && typeof burst.replaceChildren === "function") {
          burst.replaceChildren();
        }
        // Restore interactivity on whatever we inerted on show, and put
        // the inert back on the overlay if it had it before we cleared it
        // (so the upstream focus-trap's bookkeeping stays consistent).
        for (const el of inertTargets) {
          el.removeAttribute("inert");
        }
        if (wasInert) overlay.setAttribute("inert", "");
      }, 320);
    };
    dismissRef = dismiss;
    const cta = document.getElementById("onboardingCelebrationContinue");
    if (!cta) {
      // Stale markup without the CTA — keep the old timed handoff.
      setTimeout(dismiss, 1500);
      return;
    }
    cta.addEventListener("click", dismiss, { once: true });
    if (typeof cta.focus === "function") {
      try {
        cta.focus();
      } catch (_) {
        /* focus is best-effort */
      }
    }
  }

  Object.assign(root, {
    STAGES: STAGE_CELEBRATIONS,
    playOnboardingCelebration,
    spawnCelebrationConfetti,
    applyCelebrationStage,
  });
})();
