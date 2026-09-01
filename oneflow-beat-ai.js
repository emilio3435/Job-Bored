/* ============================================
   Beat B2 of the one-flow onboarding — Give it a brain.

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B2) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L1 (arrival) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Now give it a brain.";

  const SUB =
    "One AI key powers everything personal here: it drafts your fit " +
    "profile from your resume on the next screen, scores every job " +
    "discovery finds, and writes your tailored resumes and cover " +
    "letters. OpenRouter is free and takes about two minutes.";

  flow.registerBeat({
    id: "ai",
    order: 2,
    label: "AI",
    timeLabel: "about 10 min left",
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
