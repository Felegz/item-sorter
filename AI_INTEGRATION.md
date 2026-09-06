# Dropbox → OpenClaw bridge

The first integration version delegates one selected task through immutable text
files in the same Dropbox App Folder already used by the tracker. There is no
additional server and no short-interval polling.

```text
/ai/requests/<job-id>.txt   tracker writes, worker reads
/ai/results/<job-id>.txt    worker writes, tracker reads
```

The request contains a snapshot of one task and the owner's instruction. The
result contains the answer and an `ok` or `error` status. Neither side edits
`/tasks.txt` as part of AI delegation. A SHA-256 fingerprint reconnects a result
to an unchanged task; edited or deleted tasks keep their result in the global
“Поручения ИИ” list instead of attaching it to the wrong row.

## One-time Dropbox setup

1. In the existing Dropbox app's **Permissions** tab enable
   `files.metadata.read` in addition to `files.content.read` and
   `files.content.write`.
2. After the updated site is deployed, sign out of Dropbox in the tracker and
   connect it again so the new grant contains the metadata scope.
3. On the computer that runs OpenClaw execute `node ai-worker/auth.mjs`. Open the
   printed Dropbox URL, approve access, and paste the displayed authorization
   code. PKCE is used; there is no Dropbox app secret.

The refresh token is written only to
`%LOCALAPPDATA%\ItemSorterAiBridge\credentials.json`. That directory is outside
the repository. Do not copy this file into the project or send it in logs.

## OpenClaw adapter

The worker runs this safe, shell-free command shape by default:

```text
openclaw agent --agent task-assistant --message <prompt> --json --timeout 600
```

`task-assistant` must be a separate OpenClaw agent whose tools allow research
and drafting but do not allow sending messages, submitting forms, purchasing,
or changing accounts. This is an enforcement boundary; a sentence in the
prompt is not a replacement for tool restrictions.

The authorization helper detects the usual Windows npm installation and writes
an explicit Node/OpenClaw command to the local config. If the CLI lives elsewhere,
edit the non-secret local file
`%LOCALAPPDATA%\ItemSorterAiBridge\config.json` and set `openclaw.executable`.
The optional `openclaw.args` array supports `{prompt}` and `{agentId}`
placeholders for another compatible local command. The command must emit the
OpenClaw JSON envelope on stdout.

## Running

Start manually during the pilot:

```text
node ai-worker/worker.mjs
```

The worker scans existing requests once, then blocks in Dropbox `longpoll` for
up to five minutes at a time. The notify request contains only an opaque cursor,
not the OAuth token. On notification it reads changes with
`list_folder/continue`, processes jobs sequentially, and writes one result file.

Autostart is intentionally not installed until the manual pilot and resource
measurement pass. The bridge refuses a second instance using a local lock file.

## Failure and recovery rules

- A request and result are created with Dropbox `add` mode, no autorename, and
  strict conflict detection. Retries cannot silently create “(2)” files.
- The browser stores the job ID before upload. If Dropbox accepts a request but
  the response is lost, repeating the same task and instruction reuses that ID
  and verifies the existing file instead of creating a second job.
- If OpenClaw exits with an error, the worker writes an error result visible in
  the tracker. It does not automatically rerun a possibly accepted agent turn.
- Temporary Dropbox or filesystem failures enter a persisted retry queue. The
  queue is retried between longpoll waits with exponential delay; advancing the
  Dropbox cursor therefore cannot orphan a request.
- If Dropbox disconnects, the worker uses exponential backoff and respects
  `Retry-After`/longpoll `backoff`.
- A lost or expired cursor causes a full request-folder rescan. Existing result
  files prevent completed work from being repeated.
- The tracker refreshes results on page open and when the normal Sync control is
  used; it does not add a browser timer.

## Verification before production

Run the protocol and adapter tests, then use a fake OpenClaw executable for the
first end-to-end Dropbox test. A real model call is a separate checkpoint because
it consumes the configured OpenClaw provider's quota. Sending email or making
any other external change is outside this first version.
