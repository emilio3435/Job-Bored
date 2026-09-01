/* ============================================
   Beat B4 of the one-flow onboarding — Confirm your fit.

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B4) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L2 (fit) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Here's how we'll judge every job for you.";

  const SUB =
    "We drafted this from your resume. Fix anything that's off — this " +
    "is the one-time part that makes every match yours.";

  flow.registerBeat({
    id: "fit",
    order: 4,
    label: "Your fit",
    timeLabel: "about 7 min left",
    headline: HEADLINE,
    sub: SUB,
    render(container) {
      const card = document.createElement("div");
      card.className = "oneflow-placeholder";
      const title = document.createElement("h4");
      title.className = "oneflow-placeholder__headline";
      title.textContent = HEADLINE;
      const sub = document.createElement("p");
      sub.className = "oneflow-placeholder__sub";
      sub.textContent = SUB;
      card.append(title, sub);
      container.appendChild(card);
    },
  });
})();
