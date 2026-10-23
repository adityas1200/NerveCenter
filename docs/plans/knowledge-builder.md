# Knowledge builder: Sonic onboards itself like a senior hire

Status: built on `feature/knowledge-qna` (13 Oct 2026). App part: [SPEC-knowledge-03](../../specs/knowledge/knowledge-setup.md), implemented. Plugin part: the `knowledge-build` skill, added.

## Problem

We deploy NerveCenter into a client unchanged. What makes Sonic good there is the client's knowledge, and building it is manual: finding who knows what, chasing people, gathering documents, running extraction. With no agreed structure, every client's knowledge looks different.

Forms don't work either. Nobody on the client's team wants to fill in a Q&A page.

## Shape

The client's team only talks. The build lead runs the interviews. Sonic does the rest.

1. **Discover.** On the Knowledge page the build lead clicks "Set up knowledge". That opens one setup chat for the project. They attach the project charter and the past ticket export. Sonic reads those, plus everything connected (repos, job lists, Confluence and SharePoint, and the web for public vendor facts), and drafts what it can into the knowledge structure.
2. **Interview guide.** Every gap becomes a question in a guide. The guide is grouped by theme and shows each question's id (`G-7`), why it's asked, the evidence and who in the room likely knows. Questions come in two kinds:
   - broad facts that Sonic already believes, asked as confirm-or-correct;
   - specific questions tied to real tickets: "INC-4821 was fixed by a manual patch to `sales_stg`. Why, and is that the usual fix?"
3. **Interview.** The build lead downloads the guide and runs group sessions with the SMEs and the people who run the operations. Saying the question id aloud ("G-7") makes the transcript easy to match.
4. **Transcript in.** The build lead uploads the meeting transcript (`.vtt` or `.docx`) to the same chat. Sonic:
   - matches what was said to the questions;
   - checks misheard table and job names against the connections;
   - writes draft knowledge citing the transcript, timestamp and speaker;
   - marks each question answered, partly answered or not discussed;
   - adds follow-ups as round 2.
5. **Review.** The build lead keeps or discards drafts (the existing review, or PRs for Git bases).
6. **Self-check.** "Answer these 10 resolved tickets using only the knowledge, and show where you got stuck." It's a prompt, not a feature.

## Knowledge structure (plugin reference file and templates)

| Shelf | Answers |
|---|---|
| `operating-manual.md` | What Sonic is here, what it may do, who to escalate to |
| `team/` | Who owns what |
| `systems/` | Where things run |
| `data/` | What the data means |
| `pipelines/` | What each job does |
| `runbooks/` | How to do the work |
| `known-issues/` | What went wrong before, and the fix |
| `decisions/` | Why it's built this way |
| `sources/` | External links: what each is for, when to open it |
| `index.md` | The map: how agents should use the base |

It stays OKF underneath. Every claim cites a source, and Sonic never verifies its own pages.

## Ticket audit (in the skill)

Sonic checks each resolved ticket in the history, grouped by problem, against the knowledge and evidence: the commit, the job runs, config changes. Each fix gets one of four verdicts:

- **follows the runbook:** nothing to do;
- **not covered by knowledge:** becomes a question;
- **deviates from the SOP:** becomes a question, and the SOP's owner is flagged;
- **looks off** (manual patch, rerun with no cause, hardcoded value): becomes a question for the resolver's area.

Ticket exports are audited row by row, not reduced to their column headers as `knowledge-extract` does today.

## Tone

Questions read "help us understand how this was fixed", never "this broke the SOP". A deviation goes to the SOP's owner. Sonic calls a fix "off" only when it has evidence.

## Not doing

- Q&A pages or forms for SMEs.
- Teams integration.
- Recording meetings.
- Guest access.
- Scoring of experts.
- A scored exam.

## Order

1. Done: the setup button and task, Office and `.vtt` attachments, the `update_interview_guide` tool, and the Interview guide tab (SPEC-knowledge-03).
2. Done: the `knowledge-build` skill, with the structure reference, discovery, ticket audit, question patterns and transcript mapping (recorded in `plugin/SOURCE.md`).
3. Next: run it end to end on the Helixa demo. Use the ticket history, plus a mock interview transcript written in Hinglish, with misheard names.
4. Later: after go-live, lesson capture adds the questions it cannot settle to the guide as a new round.

## Found while reading (separate from this work)

- `docs/DESIGN.md` §Knowledge still says "No write, no proposals", and its out-of-scope list still includes knowledge write-back.
- Document upload and extraction, and the draft and PR review flow, have no spec.
- SPEC-projects-01 FR-35's route `POST /api/projects/:id/knowledge/promote` doesn't exist.
- `approved_only` in operations.yaml is applied by the plugin skill only.
