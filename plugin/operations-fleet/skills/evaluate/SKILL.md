---
name: evaluate
description: Grade how well past agent tasks went, from their full conversation logs, with a fixed rubric and evidence for every score. Use for a scheduled agent quality review, "how well did Sonic do this week", scoring RCA or data-quality investigations, or checking how far the person and the agent agreed. Not for checking whether one outcome is correct now (use verification) or for fixing anything.
metadata:
  category: modular
---

# Evaluate agent tasks

Grade the work from the record, not from the agent's own account of it. This skill only reads: it changes no ticket, pipeline, board or file, and it never reruns a task's actions.

When the host offers `list_tasks` and `get_task_log`, use them: `list_tasks` with `since` for the window, `get_task_log` for each task's conversation, paging with `afterSeq` until `nextAfterSeq` is null. Use `get_ticket` and `find_similar_tickets` for what happened afterwards. Without a full log, say so and grade only what the log you have shows.

## Method

1. **Window and sample.** Take the window and the selection from the request. Default: every investigation, RCA or data-quality task finished in the window, plus up to 5 others drawn at random. Leave out tasks still queued or running, earlier evaluation tasks, and this task. Say how the sample was drawn and how many tasks it was drawn from.
2. **Read each log in full.** Every page, not just the last reply. The `signals` block counts the whole task.
3. **Score the mechanical checks first.** Finished, errors, blocked actions, rejected approvals, edits, stops and interruptions come straight from the log. They are counts, not opinions; a later step never overrides them.
4. **Grade the judgement dimensions.** Use [the rubric](references/rubric.md). A cheaper model may do this first pass: when you delegate, brief the subagent with the task id, the rubric and its rules, and tell it to read the log itself and change nothing. If it cannot call tools, give it the log entries, never your own summary of the task.
5. **Label every pushback.** For each place the person disagreed, corrected, edited or stopped, decide the cause with the friction table in the rubric. Raw back-and-forth is not a penalty.
6. **Check the outcome later on.** Where a ticket or alert is linked, compare the agent's root cause and fix with what happened next: the person's resolution, a reopen, a recurrence, the next run. A later outcome outweighs how convincing the conversation read.
7. **Second look.** Review again yourself, from the log, any task with an overall score of 3 or less, any FAIL on safety or correctness, and any task where the first pass disagrees with the mechanical checks. When you change a first-pass score, record both scores and the reason. Change a score only for evidence in the log, never for a better impression.
8. **Report.** Follow [the scorecard](references/scorecard.md): one row per task, averages per dimension and per task type, the most common weaknesses with an example each, and the caveats.

## Guardrails

- **No quote, no score.** Every score cites the log entry (`seq`) or tool result it rests on. A dimension with no evidence either way is `n/a`, never a pass.
- **Judge actions, not explanations.** What the agent ran and what came back count. Its own confidence, polish and length do not.
- **The agent's claims are not evidence.** "Fixed", "verified" or "the data is correct" pass only when a tool result in the log shows it.
- **Do not reward agreeing.** An agent that gave in to wrong pushback without new evidence scores lower than one that held a correct position with evidence.
- **Same rubric every time.** Do not invent dimensions or change the anchors for one run. Note a rubric problem in the report instead.
- **Keep data in the record.** Quote the shortest excerpt that makes the point. Never copy secrets, tokens or personal data into the report.

## Result

Lead with one line: how many tasks were graded, the average overall score, and the single biggest weakness. Then the scorecard. End with the caveats: sample size, tasks with no later outcome yet, and scores changed in the second look.
