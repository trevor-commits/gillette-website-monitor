# Scheduled workflow clock repair

Owner: Codex `01a17233-b6ab-7603-b2f4-c7a506aa44da`. Integration target: main. Reused clean checkout at `a618915`. No branch or worktree created.

Trevor requested a cause-level repair on October 29. The backup scheduled for October 28 at 18:40 UTC was created at 22:49:49 UTC. Its runner started two seconds later and completed at 22:50:18 UTC. The delay preceded runner allocation and backup execution.

GitHub documents that scheduled events can be delayed or dropped under load. Both workflows already avoid minute zero. Moving the minute again cannot establish reliable timing.

Sources: [observed run](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40782917030), [GitHub scheduling limitations](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows), [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Implemented change

`workflow-clock.mjs` lets Cloudflare Cron Triggers dispatch the existing browser and backup workflows at their existing six-hour times. It bypasses GitHub's delayed schedule-event creation. The jobs, private backup processing, encryption, Drive destination, retention and independent alerts stay intact.

The clock has no public endpoint or access to lead records, recovery keys or Drive credentials. It uses one repository-scoped GitHub Actions credential. No new dependency, paid plan, browser runner or model schedule is required.

The clock identifies each scheduled slot in the workflow title and skips observed duplicate slots. Concurrent duplicate cron deliveries can still race. Existing workflow concurrency prevents overlapping job execution. Exact-once dispatch is not claimed. An ambiguous dispatch is never blindly retried.

`GILLETTE_CLOCK_SOURCE=cloudflare` gated the delayed old schedule jobs during cutover. Both obsolete GitHub cron entries are now removed after natural acceptance. Manual dispatch, inputs, concurrency, timeouts and job steps remain byte-for-byte unchanged. The ownership variable and guards remain available for rollback.

## Activation and acceptance

October29 first-slot repair: the 18:40:22UTC Cloudflare invocation threw before any subrequest. Detailed logs report `Invalid redirect value, must be one of "follow" or "manual"`; Workers does not implement `redirect: "error"`. Both requests now use `manual`, and their existing HTTP status checks reject redirects without forwarding the credential. Seven unit tests cover dispatch, deduplication, unknown schedules, missing credentials, inventory errors, ambiguous dispatch and rejected redirects. A real local Workers runtime fixture reproduced zero-request failure with old source, two-request successful dispatch with fixed source, and one-request rejection of a redirect. The installed workerd supports compatibility date2026-10-13; production retains2026-10-29. Node mocks alone had missed the runtime restriction.

The missed first backup was replayed once through the existing manual workflow. Its receipt remains historical recovery evidence, separate from the natural calendar proof below. The independent eight-hour backup deadline remains unchanged.

Current state: both natural calendar runs verified on October 29 Pacific time; obsolete GitHub cron entries retired. Seven focused tests pass. Trevor approved the scoped credential and activation in the owning thread.

The token `gillette-workflow-clock-20261029` (GitHub ID 22036544) expires January 27, 2027. Its sole selected repository is this companion; permissions are Actions read/write and required Metadata read, with no user permissions. Its value is stored only as the Cloudflare `GITHUB_ACTIONS_TOKEN` secret. Existing monthly care must renew it before expiry and verify the next scheduled output.

Cloudflare version `542798cd-a420-4953-969c-3246b97fa959` serves 100%; both original cron expressions and the sole secret binding were read back at 18:57 UTC. Downloaded runtime code contains both manual redirect settings and no unsupported error redirect setting. Repository variable `GILLETTE_CLOCK_SOURCE=cloudflare` remains active; public/preview URLs remain disabled.

The corrected remote Workers preview dispatched browser run [40934642018](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40934642018) at 18:50:55 UTC. Its 18:51:26 browser result has zero failures, zero lead POSTs, readiness 200 and independent heartbeat accepted. The previous local preview 403 was not production evidence; bounded curl with proxy bypass completed HTTP 200, and the owned preview process was reaped.

Manual backup recovery [40934478526](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40934478526) verified at 18:50:20 UTC: integrity ok, schema compatible, 6,835 encrypted bytes, no notifications and no live database modification. Its next absence deadline is approximately 02:50 UTC October 30. Neither manual result proves calendar timing. Both natural runs subsequently succeeded, as recorded below. Restore schedule ownership if the replacement fails again and cannot be repaired before its absence deadline.

## Natural calendar acceptance

| Job | Clock invocation (UTC) | GitHub run | Verified output |
| --- | --- | --- | --- |
| Browser | `2026-10-30T00:11:07Z`; success, one request/two subrequests, zero errors | [40978071467](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40978071467), created `00:11:11Z`, completed `00:11:54Z` | Checked `00:11:45.070Z`; zero failures/lead POSTs, readiness200, independent heartbeat accepted |
| Backup | `2026-10-30T00:40:22Z`; success, one request/two subrequests, zero errors | [40981153890](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40981153890), created `00:40:25Z`, completed `00:40:53Z` | Verified `00:40:50Z`; integrity ok, schema compatible, 6,836 encrypted bytes, no notifications/live database modification |

The run titles bind clock slots `2026-10-30T00:11:07.746Z` and `2026-10-30T00:40:22.242Z`. Both jobs ran source `313ba9165d122e2d8cdf0be1d3486bc045648d9f`. Backup `ok:true` is returned only after the independent heartbeat succeeds, verified against the executed source. Its absence deadline advances to approximately `2026-10-30T08:40:50Z`. These are natural executions, not manual acceptance dispatches.

The two GitHub `schedule` blocks are retired in this change. The existing Cloudflare cron expressions remain the sole calendar source. Better Stack, site Worker cron, independent missing-output alarms, encrypted backup handling and monthly care are preserved. No manual run was triggered to claim acceptance.

Recovery: restore only the two original `schedule` blocks from commit `313ba91` while `GILLETTE_CLOCK_SOURCE=cloudflare` still gates them. Publish through normal checks. At a controlled cutover, remove the clock's triggers and unset the ownership variable to restore GitHub scheduling. Keep manual dispatch. Revoke the dedicated credential only when the clock is retired. Preserve backup keys, copies and incident history.

This changes the source of scheduled events. GitHub runner delays and provider outages remain possible. Existing independent absence alarms remain the guard for missing successful output.
