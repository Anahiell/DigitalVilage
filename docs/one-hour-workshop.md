# One-hour Digital Village workshop

The browser's **Start the game** starts the new one-hour rules. Existing sessions retain their saved timing and task rules. Finish and reset an old session before starting this format; do not reset a live session just to upgrade.

## Host agenda

| Time | Activity |
| --- | --- |
| 00:00–05:00 | Join, explain roles, mark lobby readiness |
| 05:00–13:00 | Round 1: development |
| 13:00–16:00 | Discuss the saved development report |
| 16:00–24:00 | Round 2: investigate city news |
| 24:00–27:00 | Discuss facts, copied seals and false claims |
| 27:00–35:00 | Round 3: create and peer-review campaigns |
| 35:00–38:00 | Discuss usage rights and attribution |
| 38:00–46:00 | Round 4: cooperative festival tickets |
| 46:00–49:00 | Discuss team work and emergencies |
| 49:00–57:00 | Round 5: personal security exercise |
| 57:00–60:00 | End session, personal reports, final discussion |

These are five eight-minute active rounds plus twenty minutes of host-led briefing and discussion. Pauses extend wall-clock time, so the host must manage the discussion budget. A deadline opens the frozen **review** phase; it does not silently start the next round. Use **End** after round five to archive personal reports and queue report emails.

## Readiness and decision lead

Lobby readiness never starts round one. During a round, each participant marks **My round work is finished**. The host sees each team's count and pending proposals. **All teams ready — close round** only succeeds when every verified participant is ready and no pending council decisions remain. Manual round close remains available for absent participants or a hard deadline. New proposals and shared campaign drafts withdraw team readiness.

The mayor or host can appoint any verified teammate as acting mayor from **Change decision lead**. Their original role remains unchanged; approval authority moves to the deputy exclusively. The host can restore the original mayor, including during a pause or review. Delegation persists across reconnection/restart and clears on session reset. There is no automatic takeover based on unreliable connectivity; the host explicitly chooses the replacement.

## Live development

The economy and festival progress update on the server every second. Economic rates are scaled to preserve the original per-minute rate. History samples remain approximately ten seconds apart to bound storage and bandwidth. State polling uses a single regular in-flight request; slow Wi-Fi cannot starve every response with overlapping polls.

The living-city view reflects approved buildings. Animated traffic, resident homes, interpolated counters and card arrivals respect reduced-motion preferences. Pausing stops the simulation and traffic movement; losing the connection stops traffic movement and shows reconnection status. This is a lightweight city dashboard, not a 3D city engine.

Round one starts with one investment. Another unlocks each active minute, through minute seven: broadband, skills academy, health hub, startup incubator, solar, food garden, shuttle and library. The server rejects early purchases, including direct API calls. The funding cut arrives at four active minutes unless the host pauses or cancels it.

## News investigation

Sixteen stories arrive one at a time every thirty active seconds, interleaved across four cities. Each city has two factual and two fabricated stories in independently shuffled order. Players can open every city's public record, including a frozen, dated round-two bulletin with budget, young residents, indicators and completed projects. Compare news with that bulletin rather than later live totals. A genuine copied seal is intentionally insufficient evidence.

Before proposing a story, the proposer saves a short fact-check describing the number or project checked. The current decision lead approves the village's selection, up to six stories about other cities. False reports are legitimate discussion material; the server checks participation and eligibility, not the quality of free-text reasoning. The host reveals the factual explanation and discusses the evidence.

## Campaign cooperation

An author shares the draft with the council. A different teammate reads its text, assets, usage cards and credit, then saves a review. The check is bound to the exact text/assets/credits and current published version. An altered draft needs a new check. The author submits the checked draft for mayor approval. Local editor text survives polling; teammates can load the shared draft into their own editor. Single-player rehearsals can publish without an unavailable second participant.

## Festival tickets

For `n` verified players in each village, the total is `ceil(n × 3 × 1.25 / 4) × 4`, rounded to a multiple of four. Five players receive twenty tickets: fifteen standard plus five red critical tickets. The red tickets appear after two active minutes, with a visible alert; the host can also trigger them manually. Empty villages receive no tickets. Rosters are sized when tickets are generated; enrol participants before the festival begins.

Each player can own **three active unfinished tickets**. Completing or releasing a ticket frees a slot, so five people can complete twenty tickets in successive batches. Claiming a fourth is rejected on the server. Critical tickets are visually red and appear first. Mobile filters show **Focus**, **Critical tickets**, **My active tickets** or **All tickets** without losing the selected filter on refresh.

The owner performs preparation steps. A different teammate checks the prepared work. Without both contributions the ticket cannot finish and automatic progress stops at 80%. The ten-second action delay and waiting reason are shown on the card. Matching expertise speeds the background progress; taking several tickets divides that progress. Releasing and reclaiming does not erase numeric progress, but a new owner must prepare the work and get a new check. Global pause and crisis pause block the respective work; crisis cancellation withdraws red tickets. Festival scoring and saved reports use the generated task totals rather than hard-coded six-ticket denominators.

## Security and persistence

Round-five exercise messages say **Digital City**, while the real game remains **Digital Village**. The Gmail SMTP display name also changes only for exercise messages. The harmless landing page explains this similar-name impersonation clue; it never collects passwords, PINs or payment details. Existing personal click tracking and resends remain available.

Final reports, mail queue, SQLite reset protections and private report access remain intact. New readiness, deputy, draft, review and collaboration tables clear only on confirmed finished-session reset. Backups, SMTP credentials, domain automation and Tailscale configuration are not changed by this feature.

## Verification

Run `npm test`, `npm run test:e2e`, `npm run load-test` and `npm run load-test:hour`. The latter exercises thirty HTTP clients at one-second polling. `tests/workshop.test.js` drives thirty bots through all five rounds using accelerated clocks, including collaborative completion, reports and reset. Browser tests use desktop and Pixel 7 emulation. Production Gmail inbox receipt and physical Android scanning remain separate deployment checks.
