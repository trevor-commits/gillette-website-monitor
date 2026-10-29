# Scheduled workflow clock repair

Owner: Codex `01a17233-b6ab-7603-b2f4-c7a506aa44da`. Integration target: main. Reused clean checkout at `a618915`. No branch or worktree created.

Trevor requested a cause-level repair on October 29. The backup scheduled for October 28 at 18:40 UTC was created at 22:49:49 UTC. Its runner started two seconds later and completed at 22:50:18 UTC. The delay preceded runner allocation and backup execution.

GitHub documents that scheduled events can be delayed or dropped under load. Both workflows already avoid minute zero. Moving the minute again cannot establish reliable timing.

Sources: [observed run](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40782917030), [GitHub scheduling limitations](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows), [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Prepared change

`workflow-clock.mjs` lets Cloudflare Cron Triggers dispatch the existing browser and backup workflows at their existing six-hour times. It bypasses GitHub's delayed schedule-event creation. The jobs, private backup processing, encryption, Drive destination, retention and independent alerts stay intact.

The clock has no public endpoint or access to lead records, recovery keys or Drive credentials. It uses one repository-scoped GitHub Actions credential. No new dependency, paid plan, browser runner or model schedule is required.

The clock identifies each scheduled slot in the workflow title and skips observed duplicate slots. Concurrent duplicate cron deliveries can still race. Existing workflow concurrency prevents overlapping job execution. Exact-once dispatch is not claimed. An ambiguous dispatch is never blindly retried.

`GILLETTE_CLOCK_SOURCE=cloudflare` disables only the old schedule-triggered jobs. Manual dispatch remains available. Until that variable is set, the existing GitHub schedules continue unchanged.

## Activation and acceptance

October29 first-slot repair: the 18:40:22UTC Cloudflare invocation threw before any subrequest. Detailed logs report `Invalid redirect value, must be one of "follow" or "manual"`; Workers does not implement `redirect: "error"`. Both requests now use `manual`, and their existing HTTP status checks reject redirects without forwarding the credential. Seven unit tests cover dispatch, deduplication, unknown schedules, missing credentials, inventory errors, ambiguous dispatch and rejected redirects. A real local Workers runtime fixture reproduced zero-request failure with old source, two-request successful dispatch with fixed source, and one-request rejection of a redirect. The installed workerd supports compatibility date2026-10-13; production retains2026-10-29. Node mocks alone had missed the runtime restriction.

The missed backup is replayed once through the existing manual workflow to preserve recovery coverage. That replay is not natural clock proof. Require subsequent real Cloudflare browser00:11UTC and backup00:40UTC executions before retiring the retained GitHub schedule definitions. The independent eight-hour backup deadline remains unchanged.

Current state: redirect repair deployed October 29 at 18:50 UTC; natural calendar acceptance remains pending. Seven focused tests pass. Trevor approved the scoped credential and activation in the owning thread.

The token `gillette-workflow-clock-20261029` (GitHub ID 22036544) expires January 27, 2027. Its sole selected repository is this companion; permissions are Actions read/write and required Metadata read, with no user permissions. Its value is stored only as the Cloudflare `GITHUB_ACTIONS_TOKEN` secret. Existing monthly care must renew it before expiry and verify the next scheduled output.

Cloudflare version `542798cd-a420-4953-969c-3246b97fa959` serves 100%; both original cron expressions and the sole secret binding were read back at 18:57 UTC. Downloaded runtime code contains both manual redirect settings and no unsupported error redirect setting. Repository variable `GILLETTE_CLOCK_SOURCE=cloudflare` remains active; public/preview URLs remain disabled.

The corrected remote Workers preview dispatched browser run [40934642018](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40934642018) at 18:50:55 UTC. Its 18:51:26 browser result has zero failures, zero lead POSTs, readiness 200 and independent heartbeat accepted. The previous local preview 403 was not production evidence; bounded curl with proxy bypass completed HTTP 200, and the owned preview process was reaped.

Manual backup recovery [40934478526](https://github.com/trevor-commits/gillette-website-monitor/actions/runs/40934478526) verified at 18:50:20 UTC: integrity ok, schema compatible, 6,835 encrypted bytes, no notifications and no live database modification. Its next absence deadline is approximately 02:50 UTC October 30. Neither manual result proves calendar timing. Require natural browser 00:11 UTC and backup 00:40 UTC October 30 before removing the retained GitHub schedule definitions. Restore schedule ownership if the replacement fails again and cannot be repaired before its absence deadline.

1. Approve a fine-grained token for only `trevor-commits/gillette-website-monitor`, with Actions read/write and required Metadata read. Use a 90-day expiry and record its renewal date. Store it only as `GITHUB_ACTIONS_TOKEN` in the dedicated Cloudflare Worker. Do not use the broad personal CLI token.
2. Verify the business Cloudflare account and deploy with `wrangler.clock.jsonc`. Keep the next calendar opportunity far enough away to complete cutover without overlapping ownership.
3. Run a bounded dispatch acceptance with the approved credential. Verify the exact workflow run, execution result and independent heartbeat. A request accepted by GitHub is not completed job proof.
4. Set `GILLETTE_CLOCK_SOURCE=cloudflare` once dispatch acceptance passes. Read back the repository variable and both live Cron Triggers.
5. Require an actual Cloudflare calendar dispatch for each job. Bind the scheduled slot, dispatch timestamp, GitHub run and successful output. Preserve the eight-hour backup and 28-hour browser absence deadlines.
6. Only after natural proof, remove the obsolete GitHub schedule entries and update the operating record. Keep manual dispatch and rollback instructions.

Recovery: unset `GILLETTE_CLOCK_SOURCE` and remove the clock's triggers to restore the retained GitHub scheduler. Revoke the dedicated credential when the clock is retired. Preserve backup keys, prior copies and incident history.

This changes the source of scheduled events. GitHub runner delays and provider outages remain possible. Existing independent absence alarms remain the guard for missing successful output.
