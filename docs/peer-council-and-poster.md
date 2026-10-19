# Active team decisions and the mobile poster studio

New browser-started one-hour sessions use the **peer council**. A mayor is not required. Older saved sessions retain their existing approval rules until the next new session.

## Decision rules

The author supplies the first supporting vote. Any different verified teammate can confirm the proposal. With no objections, two supporters apply the action immediately. A one-person rehearsal can confirm its own proposal. If somebody objects before application, support or objections need a strict majority of the verified village roster (`floor(n/2)+1`). For five participants that is three votes. Votes can change while the proposal remains pending. Accepted/rejected proposals are final and repeated requests cannot spend again.

Do not silently reduce the majority when someone disconnects: the host has explicit, logged **Host confirms / Host declines** controls for stalled discussions. They work only in the currently playing round. Session pause, closed rounds, village boundaries, investment availability, actual available funds and stale versions remain authoritative server checks.

The ordinary flow needs two people, rather than one specific mayor. Responsibility should rotate: a finance proposal can be reviewed by digital, digital by media, media by events, and events by a community advisor. Disputes are discussions, not automatic rejections. The original deputy mechanism remains only for older session formats.

## Development round

Project cards show indicator changes, funds after purchase and the estimated ongoing budget effect. Per-minute net effect is six times the ten-second economy formula:

`6 × (1.95 × jobs + 0.45 × trust − 0.92 × internet − 0.75 × education − 1.05 × services)`

The estimate includes the 0.45 running cost per job and indicator saturation at 100. It deliberately excludes migration and random events. Each participant can record a role-specific recommendation on an available project. These notes are public to their village, do not spend funds and do not lock the project. This gives research and budget planning a visible contribution without creating another approval queue.

## Concrete campaign assignment

Create a mobile social advertisement for **Youth Futures Festival**, aimed at people aged 18–30. Include the village and event name, a date/time, meeting place, two activities, a reason to visit, and a clear call to action. Use one to five visual assets and the required credit. The publisher must provide at least eighty characters, a call to action and a visual asset; the host discusses the full brief and visual quality.

For five people, assign writer, designer, city fact checker, asset-rights checker and audience/readability tester. One shared poster is the team's deliverable; successive drafts improve it. A different teammate reviews the exact text, assets, attribution and layout. Changing any of these requires another check. Publication then follows peer council rules.

## Editor

The native Canvas editor supports finger dragging with pointer capture, a layer selector, arrow-key/button movement, text/asset scale, four colour themes, portrait/square/landscape formats, layout reset and PNG download. Text controls remain standard Android inputs. Movement is bounded, overlapping text produces a warning, and colour backplates protect text contrast. Keyboard/buttons are alternatives to dragging. Only the canvas consumes the drag gesture; scroll elsewhere on the page.

Draft text, selected assets, published version and layout are saved locally under the participant/session key; passwords and PINs are never stored there. Reloading restores the draft. Shared drafts use a digest lease: a teammate cannot overwrite a changed draft from an older local copy. Local work is retained on conflict. Shared previews render the actual saved layout, and publishing persists that layout in SQLite and final report data. A new server publication with different content still requires loading/reviewing that version rather than silently overwriting it.

## Brand scenarios and costs

There are 23 real brand names: Apple, BMW, McDonald's, Nike, adidas, Coca-Cola, Red Bull, Spotify, Netflix, Google, YouTube, TikTok, Samsung, LEGO, IKEA, Starbucks, Tesla, Visa, Mastercard, Amazon, Canon, Adobe and Microsoft. They appear as brand-name tiles, not a bundled collection of official logo files. All contract availability, fees and campaign permission judgments are fictional teaching scenarios, not claims of real brand authorisation.

Some materials are free; CC BY artwork needs the supplied attribution; some brand tiles have a paid workshop contract; some sponsorship claims have no available contract. Purchasing a contract is a peer-approved council action that spends actual game funds once and remains valid for subsequent edits in the session. It is not a real licence purchase. Twenty new names supplement the original three.

Controlled scenario, starting budget €10,000 and trust 72, one asset, no elapsed economy time:

| Choice | Contract fee | Campaign outcome | Closing budget | Trust |
| --- | --- | --- | --- | --- |
| Free workshop mountain art | €0 | +€650 | €10,650 | 73 |
| Nike tile without the workshop contract | €0 | −€2,500 | €7,500 | 68 |
| Nike tile with the fictional contract | €2,400 | +€650 | €8,250 | 73 |

Paid branding is a design choice, not a shortcut to a larger reward. Free permitted artwork is economically preferable. Discuss attribution and claims rather than teaching that every mention of a brand is automatically unlawful.

## Verification and limits

Tests exercise a complete five-person game with **no mayor**, all roles contributing, majority disputes, self-approval denial, concurrent approval, host moderation, exact-layout review, controlled financial outcomes, thirty-player sessions, archive/reset/mail regressions and HTTP load. Chromium's Pixel 7 emulation dispatches actual touch events, changes layout, reloads, peer-reviews, publishes and downloads a PNG whose dimensions are verified.

This is a functional lightweight poster editor, not the full Canva product. Physical Android/browser/download behavior, actual workshop discussion quality, Raspberry Pi performance and real email inbox receipt need deployment rehearsal. Accelerated bot clocks do not substitute for five humans taking a real hour. The staged development round can still include discussion intervals; recorded recommendations and rotating reviewers make those intervals purposeful, rather than making every role wait for the mayor.
