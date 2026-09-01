/* ============================================
   Beat B1 of the one-flow onboarding — Connect Google.

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B1) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L1 (arrival) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Your pipeline lives in a Google Sheet you own.";

  const SUB =
    "Sign in and we'll create it for you. Nothing is stored on our side " +
    "— there is no 'our side.'";

  flow.registerBeat({
    id: "google",
    order: 1,
    label: "Google",
    timeLabel: "about 15 min left",
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
