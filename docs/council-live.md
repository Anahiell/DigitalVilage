# Council decisions and stable live screens

The browser reconciles existing DOM nodes instead of replacing the app on each state refresh. Details stay open, text selections and focused inputs survive, and charts, counters and task ownership update around the current interaction. Numeric dashboard changes animate for 450 ms from one real server value to the next; reduced-motion users get the final value immediately. The remaining-time display advances locally from the last server timestamp and stops on pause or disconnection. Economy and task work still use the existing authoritative ten-second server tick. Polling remains 3.5 seconds: faster polling of all players would consume more of the free gateway quota without making the world tick faster.

## Starting a workshop

Players first see a dedicated briefing with their role, team and instructions. I'm ready only records readiness; it cannot start a round. The host sees the readiness count and explicitly starts round one. Participants move to Current round, which puts their challenge and next action before the analytics dashboard. Pause/resume does not move them to a different view or steal input focus. Mobile navigation has four destinations rather than eight narrow buttons.

New starts from this host UI include `councilApprovals: true`. The persisted `game.council_approvals` flag enables the new decision process for that entire session and survives restart. Existing sessions and legacy API clients that omit the start flag retain their previous direct-action rules; no existing live workshop silently changes its decision policy. Begin a new workshop with the updated host UI to use approvals.

## Mayor approval

Every signed-in council role can propose an investment, news selection/removal or campaign. Shared results change only after that village's mayor chooses Approve and apply. The mayor also submits their own proposed changes for explicit review. All members see pending, approved, rejected and expired statuses. The mayor receives a non-interrupting notification and pending count after a new request arrives.

One pending request per village/resource prevents competing clicks from duplicating an investment, selecting the same news twice or overwriting a waiting campaign. Identical submissions return the existing request; different conflicting proposals are rejected with an explanation. Approval rechecks funds, the open round, reveal state, six-news limit and campaign version inside the same SQLite transaction as the change and decision status. Repeated approvals cannot apply twice. Only the same village's mayor may review a request. Paused games cannot apply pending requests. Closed-round requests expire without changing results.

Campaign drafts stay local while waiting and are not overwritten by polling. A campaign proposal includes its text, assets, credits and base revision for the mayor to review. A stale revision is rejected while the player's local draft stays intact. Individual festival task claims/help and security answers remain direct personal actions.

The host should ensure every participating village has a mayor. Without one, proposals remain pending and the UI explicitly explains how to enrol the missing mayor. There is no hidden host override of mayor decisions.

## Host and Android controls

Manual funding/news/license/festival controls stay visible after use and show why they are unavailable. Existing grants remain. Direct village adjustment can add or subtract up to €250,000 budget, 100 residents, or 25 indicator points per action, with valid-range clamping, server authorization and a recorded before/after event. Global pause blocks adjustments. An enum allowlist prevents arbitrary SQL columns.

The phone festival board uses vertically stacked columns and readable cards with 44-pixel actions, named task ownership, clear help cooldown messages and stable cards during polling. It no longer uses a horizontal mandatory-snap carousel that jumped back when the screen was replaced.

## Data and verification

Council proposals are live session data and are cleared in the existing atomic finished-session reset. Archived reports and queued report emails retain their existing lifecycle. SMTP, domain and deployment settings are unchanged.

`node --test tests/council.test.js` covers readiness, simultaneous proposals, repeated approvals, cross-village isolation, news and campaign approval, stale edits, reveal/round boundaries, host authorization, pause/restart/reset and a 30-player council rehearsal with task claim races. Existing HTTP load remains separate.

`node --test tests/council-live.e2e.mjs` runs desktop host plus two Pixel 7 browser contexts against the actual server handler and SQLite. It verifies readiness/start, mayor approval, persistent DOM nodes, focused drafts and details through several polling intervals, live metrics and a vertical mobile board. This is Android-size Chromium emulation, not a physical-device test. Existing participant, pause/report/reset and HTTP browser flows remain in CI.
