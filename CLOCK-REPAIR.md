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

Current state: prepared and locally tested, not deployed or activated. Six focused tests pass. No dispatch token was created or copied.

1. Approve a fine-grained token for only `trevor-commits/gillette-website-monitor`, with Actions read/write and required Metadata read. Use a 90-day expiry and record its renewal date. Store it only as `GITHUB_ACTIONS_TOKEN` in the dedicated Cloudflare Worker. Do not use the broad personal CLI token.
2. Verify the business Cloudflare account and deploy with `wrangler.clock.jsonc`. Keep the next calendar opportunity far enough away to complete cutover without overlapping ownership.
3. Run a bounded dispatch acceptance with the approved credential. Verify the exact workflow run, execution result and independent heartbeat. A request accepted by GitHub is not completed job proof.
4. Set `GILLETTE_CLOCK_SOURCE=cloudflare` once dispatch acceptance passes. Read back the repository variable and both live Cron Triggers.
5. Require an actual Cloudflare calendar dispatch for each job. Bind the scheduled slot, dispatch timestamp, GitHub run and successful output. Preserve the eight-hour backup and 28-hour browser absence deadlines.
6. Only after natural proof, remove the obsolete GitHub schedule entries and update the operating record. Keep manual dispatch and rollback instructions.

Recovery: unset `GILLETTE_CLOCK_SOURCE` and remove the clock's triggers to restore the retained GitHub scheduler. Revoke the dedicated credential when the clock is retired. Preserve backup keys, prior copies and incident history.

This changes the source of scheduled events. GitHub runner delays and provider outages remain possible. Existing independent absence alarms remain the guard for missing successful output.
