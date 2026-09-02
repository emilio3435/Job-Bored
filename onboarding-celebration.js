/* ============================================
   The one celebration (ONE-FLOW-ONBOARDING-SPEC §5 B6, §7).

   The teardown counted FOUR confetti bursts before the user's first job.
   The spec collapses them to ONE, at B6, with the payoff attached.

   SIXBEATS2 (docs/programs/sixbeats2-20260902/SIXBEATS2-SPEC.md, locked
   decision 2) then changed WHAT that one moment is. The acceptance rerun
   found this overlay mounted on top of Beat 6 as a full-viewport
   `role="dialog" aria-modal="true"` card with `pointer-events: auto`,
   z-index 100002, carrying a second, older payoff — the three-circle
   ✓ PROFILE ✓ JOB DISCOVERY ✓ OTHER DEVICES strip, its own
   `See what happens now →` primary, and an `or start with your other
   devices →` link. It never dismissed itself: `Run discovery now` was
   covered for the whole 29 870 ms sample (rerun NEW-1, BLOCKER).

   So the finale is no longer a modal. It is a BURST: confetti plus the
   title and sub float over a fully visible, fully clickable Beat 6 for
   ~2.5 s and then fade. No journey strip, no alt link, no CTA gate, no
   inerting, no focus steal — the beat underneath keeps the screen, and
   the burst is announced politely rather than trapping assistive tech
   behind aria-modal.

   index.html still ships the legacy card markup (journey strip, CTA, alt
   link) for the deleted wizard stages; `normalizeBurstOverlay` strips it
   on the way up, so the burst is what renders no matter which build of
   the markup is cached.

   Classic-global IIFE under window.JobBoredOnboardingCelebration.
   ============================================ */
(function () {
  const root =
    window.JobBoredOnboardingCelebration ||
    (window.JobBoredOnboardingCelebration = {});

  /**
   * How long the burst floats, and how long it takes to fade out after
   * that. Spec decision 2 says ~2.5 s: long enough to read two lines,
   * short enough that nobody waits on it — and it is a TIMER, not an
   * animation end, so the reduced-motion path (where the confetti never
   * animates at all) dismisses on exactly the same schedule.
   */
  const TIMINGS = { burstMs: 2500, fadeMs: 320 };

  const BURST_CLASS = "onboarding-celebration--burst";

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
  // Two keys, because the burst says two things. The `cta` and the journey
  // `currentIndex` went with the modal (SIXBEATS2 decision 2): there is no
  // CTA to gate on and nothing is "next" at B6.
  const STAGE_CELEBRATIONS = {
    flow_payoff: {
      title: "You're live.",
      sub: "That was the one-time part. From here, JobBored works for you.",
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
  }

  function dropNode(node) {
    if (node && typeof node.remove === "function") node.remove();
  }

  /**
   * Turn whatever markup the page shipped into the burst.
   *
   * Two jobs. First, the legacy card body goes: the journey strip, the
   * CTA and the alt link were the modal's whole reason to block, and
   * leaving them would leave a second payoff arguing with the real one.
   * Second, the overlay stops claiming to be a dialog — decoration over a
   * live beat must not hide that beat from assistive tech, so it becomes
   * a polite live region that announces the two lines and gets out of
   * the way. The class carries the CSS that turns pointer events off.
   */
  function normalizeBurstOverlay(overlay) {
    if (!overlay) return;
    if (typeof overlay.querySelectorAll === "function") {
      const legacy = [
        ".onboarding-celebration__journey",
        ".onboarding-celebration__cta",
        ".onboarding-celebration__alt",
      ];
      for (const selector of legacy) {
        for (const node of Array.from(overlay.querySelectorAll(selector) || [])) {
          dropNode(node);
        }
      }
    }
    for (const id of [
      "onboardingCelebrationContinue",
      "onboardingCelebrationAlt",
    ]) {
      dropNode(document.getElementById(id));
    }
    if (typeof overlay.removeAttribute === "function") {
      overlay.removeAttribute("aria-modal");
      overlay.removeAttribute("aria-labelledby");
    }
    if (typeof overlay.setAttribute === "function") {
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
    }
    if (overlay.classList) overlay.classList.add(BURST_CLASS);
  }

  /**
   * Play the finale. NON-BLOCKING: the burst floats over the beat for
   * TIMINGS.burstMs and then fades itself out; `onDone` runs at fade
   * START, which is where the old player ran it too, so a caller that
   * chains something behind the celebration still mounts it under the
   * fade rather than after a blink. Degrades gracefully: no overlay in
   * the DOM → immediate onDone, so the handoff can never strand.
   */
  function playOnboardingCelebration(onDone, stageKey, opts) {
    const finishCb = typeof onDone === "function" ? onDone : () => {};
    const overlay = document.getElementById("onboardingCelebration");
    if (!overlay) {
      finishCb();
      return;
    }
    normalizeBurstOverlay(overlay);

    // Show FIRST, then write the copy: the overlay is a live region now,
    // and a region that is still `hidden` when its text changes announces
    // nothing.
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("onboarding-celebration--out");
    overlay.classList.add("onboarding-celebration--in");
    applyCelebrationStage(overlay, stageKey || "flow_payoff", opts || {});

    const burst = document.getElementById("onboardingCelebrationConfetti");
    if (burst) {
      if (typeof burst.replaceChildren === "function") burst.replaceChildren();
      spawnCelebrationConfetti(burst);
    }

    let finished = false;
    const dismiss = () => {
      if (finished) return;
      finished = true;
      overlay.classList.add("onboarding-celebration--out");
      try {
        finishCb();
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
      }, TIMINGS.fadeMs);
    };
    setTimeout(dismiss, TIMINGS.burstMs);
  }

  Object.assign(root, {
    STAGES: STAGE_CELEBRATIONS,
    TIMINGS,
    playOnboardingCelebration,
    spawnCelebrationConfetti,
    applyCelebrationStage,
    normalizeBurstOverlay,
  });
})();
