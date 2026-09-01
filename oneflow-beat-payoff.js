/* ============================================
   Beat B6 of the one-flow onboarding — You're live (the payoff).

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B6) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L4 (bookends) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "You're live, {firstName}.";

  const SUB =
    "That was the one-time part. From here, JobBored works for you.";

  flow.registerBeat({
    id: "payoff",
    order: 6,
    label: "Done",
    timeLabel: "almost done",
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
