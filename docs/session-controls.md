# Session controls

All game time comes from the server and is saved in SQLite. Players receive the
same phase, remaining round time and effective crisis status on state refresh.

- **Pause game** freezes the round clock, simulation ticks, economy, assigned
  tasks and crisis countdowns. Manual grants, event triggers and advancing to the
  next round are rejected while paused. Already saved reports remain readable.
- **Resume game** restores the remaining time, including a partial ten-second
  simulation tick. A separately paused crisis stays paused. Repeated pause or
  resume requests are idempotent; the browser sends a phase revision to reject
  outdated timeline commands from another tab.
- A server restart during play recovers into a pause at the last persisted tick.
  The host sees the recovery reason and must choose Resume game.
- A round timeout enters **Review**, not Ended. The host discusses the saved
  report and opens the next round. After round five, the host explicitly finishes.
- **End session permanently** requires confirmation and saves final reports and
  their email jobs in one transaction. It cannot be resumed. The finished screen
  explains how to view results and where to reset for another session.
- **Reset game** is available only after ending, requires the host password and
  typed confirmation, and rejects concurrent or outdated resets. It clears the
  live session's accounts, PINs, assignments, answers, tasks, crises, timers and
  results, retaining archived final reports, report access and report mail jobs.
  Scenario definitions, configuration, SMTP settings and host access survive.

Queued exercise emails wait during a global pause and their retry/expiry times
are shifted by the time actually spent paused. PIN and final-report delivery can
continue. An SMTP request already in flight cannot be recalled. Provider
acceptance is recorded separately from actual inbox receipt.

## Verification

`npm test` runs the complete unit/integration suite. `npm run load-test` runs the
original TCP/HTTP 30-player rehearsal. `npm run test:e2e` runs browser flows.

For environments that prohibit localhost connections, `npm run test:session`
uses the actual handler and a temporary on-disk SQLite database without a TCP
listener. Its 30-player load includes timeouts, recovery, personal reports,
transaction rollback, racing resets, archived access and synthetic SMTP delivery
of all 30 durable report jobs after reset and restart. This is not an HTTP
throughput measurement. `npm run test:e2e:session` routes desktop/mobile Chromium
requests through the same handler; game logic is not mocked.

The PR workflow runs full HTTP integration, load and browser tests on a GitHub
runner. It has read-only repository access and no deployment or production
credentials. No Raspberry Pi deployment is part of these changes.
