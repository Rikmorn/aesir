# Learnings

One record per closed issue or milestone that clears the bar, linked from the close comment that produced it. Sidekick's `sk-track` and `sk-milestone` write records in the shape this file states, and the bar and the shape follow sidekick's own learnings README.

## The bar

A record is written only when the counterfactual holds. Without this record, would the next engineer repeat the mistake or redo the investigation? A close that taught nothing durable gets no record. The issue and its close comment already say what was done and why; a record says what was learned.

## The shape

`YYYY-MM-DD-<slug>.md`, the slug a content name. Near the top, the issue or milestone it came from (`#NN`). Then three headings:

- **Context.** The situation, briefly: what was being done, and what was expected.
- **Lesson.** What turned out to be true, stated so it transfers beyond this case.
- **Consequences.** What changed because of it: a rule amended, a check added, a convention ruled, or nothing yet and why.

When a lesson graduates into a rule or a reference doc, add `Status: promoted to <rule or doc>` directly under the `#NN` line. Leave the record as it was written. A record is history; the rule is where the lesson lives now.

Records written before this README keep the shape they were written in.
