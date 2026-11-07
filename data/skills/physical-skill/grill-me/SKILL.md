---
name: grill-me
description: "Use when stress-testing a plan, idea, or design before committing to it. Invoke when the user wants to be challenged on their thinking, says 'grill me' / 拷問我, asks to pressure-test or stress-test a decision, or before significant architecture choices. Triggers on: grill me, stress-test, pressure-test, challenge my plan, interrogate my design, 拷問, 檢視計畫, 电击测试."
license: Apache-2.0
metadata:
  author: https://github.com/tenequm
  version: "0.1.3"
  domain: planning
  triggers: grill me, stress-test, pressure-test, design review, 拷問
  role: interviewer
  scope: planning
  output-format: text
  related-skills: architecture-designer, api-designer
---

# Grill Me 🔥

Interview the user relentlessly about every aspect of their plan until you reach shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

This is not hostile debate — it is calibrated pressure. The goal is that every major decision and assumption has been surfaced, challenged, and agreed before work begins.

## Core Rules

- Ask the questions **one at a time**, waiting for feedback on each before continuing.
- **Give a recommended answer for every question** — never ask open-ended questions without a position.
- If a question can be answered by reading files, code, docs, issues, or logs — **explore the codebase instead of asking**.
- Ask each question as plain text in your normal reply. Options and your recommendation belong in the message body itself.
- Keep track of unresolved decisions, assumptions, risks, and dependencies as you go.

## Interview Loop

1. **Map the tree** — identify the major decision areas of the plan (scope, architecture, data, failure modes, rollout).
2. **Prioritize** — start with the decision that most constrains the others.
3. **Ask** — one question, with your recommended answer and the tradeoff it implies.
4. **Resolve** — record the answer, then descend into the next dependent decision.
5. **Repeat** until every branch reaches shared understanding.

## Exit Criteria

Stop when:
- Every major decision has an explicit answer or an explicit "decide later" with a trigger date/condition.
- All cross-cutting risks have been surfaced with an owner or mitigation.
- The user can restate the plan in one paragraph and you agree with their restatement.

## Output

End with a summary: decisions made, assumptions on record, open items with triggers, and the single biggest remaining risk.
