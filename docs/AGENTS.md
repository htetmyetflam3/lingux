# AGENTS.md — working rules for this repo

Read `docs/PROJECTSTRUCTURE.md` first. It tells you where things are and which
"obvious" assumptions are wrong here. This file tells you how to behave.

---

## The short version

1. **One task at a time.** The owner hands tasks over sequentially. Finish the
   one you were given. Do not start the next one because it seems related.
2. **Test what you changed** — actually run it. Do not reason about behaviour
   and call it verified.
3. **Reusable scripts go in `Tools/`**, never `/tmp`.
4. **Before opening a PR: bump the version in `package.json` and write a
   `CHANGELOG.md` entry.**
5. **Ask architecture questions, not plumbing questions.** Plain language, one
   or two at a time — not a wall of options.

---

## 1. Before you touch anything

- Read `docs/PROJECTSTRUCTURE.md`. Blind `grep` wastes turns and finds the
  wrong file (there are two `paths.js`, two HTML pages, two deployments).
- Check `Tools/scripts.db` before writing a utility — 63 scripts already exist:
  `node Tools/scrmgr.js list`.
- Check `Tools/test/` before writing a test.
- If a seam looks unfinished, **ask**. Several are deliberate.

## 2. Things that are intended, not broken

Do not "fix" these, and do not report them as findings:

- curl gets **403** — the bot-UA block is the design.
- `/api/submit` returns **202 immediately** — hash/token driven, client polls.
- Site and Engine directory constants differ — they deploy separately.
- `GET /` 404s in dev — the frontend build is not present.
- The production MySQL is unreachable from dev/sandbox. Environmental.
  **Do not build threat models around curl** — it is a testing path only.

## 3. Testing

Prove it, with output:

```bash
SKIP_BUILD=true node Site/index.js        # start the server (needs SKIP_BUILD)
node Tools/test/db-contract.test.mjs      # no DB required — fake pool
bash Tools/test/http-e2e.test.sh          # needs the server running
```

Rules learned the hard way:

- **The DB is unreachable.** Test DB code with a **fake pool**, not over HTTP.
  It is also the only way to assert "zero writes" or "rolled back".
- mysql2 returns `DATE` columns as `Date` objects. String fixtures lie.
- Test scripts in `/tmp` cannot import repo modules by relative path. Put them
  in `Tools/test/` — that is what it is for.
- Never `pkill -f "node Site/index.js"` — it kills your own shell. Track the
  PID, or use the process tooling.
- Clean up generated artifacts (`.output/`, `upload/quarantine/`, stray
  uploads) when you finish. Do **not** delete tracked fixtures such as
  `upload/input/pdf/test.pdf` or `.gitkeep` files — check `git status` after
  cleaning.
- A background extraction is still running after the 202. Deleting its working
  directory mid-flight will fail the job. Wait, or expect the 422.

Lint (the flat config needs `@eslint/js`, sometimes missing):

```bash
npm install --no-save --no-package-lock @eslint/js eslint
node node_modules/eslint/bin/eslint.js <files>
```

## 4. Writing code here

- **Comment the *why*, not the *what*.** The interesting information in this
  codebase is why a rule exists (encoding traps, gate ordering, the save
  gate), not what a line does.
- Use the repo's own tooling: `Tools/fix-import.js` for broken imports
  (run `node fix-import.js ../Site/Server/` **from inside `Tools/`**).
- New optional behaviour should degrade to *safe*, not *open* — see
  `Server/cookie/devbypass.js`: delete the file and the gate stays **enforced**.
- Prefer editing an existing seam over adding a parallel one. There must stay
  exactly **one** quota charge point (the save gate).
- Anything that touches Burmese text must be encoding-aware. Zawgyi vs Unicode
  is the recurring bug source in this project.

## 5. Finishing a task — the release ritual

Do all of this **before** opening the PR:

**a. Bump the version** in `package.json` (root). Bump the sub-package
(`Site/Server/package.json` or `Private/package.json`) too if you changed it.

| Change | Bump |
|---|---|
| bug fix, no behaviour change | patch — `1.3.0 → 1.3.1` |
| new feature, back-compatible | minor — `1.3.0 → 1.4.0` |
| breaking change to an API/response shape | major |

**b. Write a `CHANGELOG.md` entry** at the top, newest first:

```markdown
## [1.4.0] - 2026-09-08

### Added
- Short line. What changed, and why it matters.

### Changed
### Fixed
### Removed
```

Keep it short. One line per change. Say the *effect*, not the file list —
"PDF text now extracted server-side" beats "modified parser.js".

**c. Clean the tree.** `git status` should show only intended files. No
`.output/`, no scratch files, no test uploads.

**d. Commit and open the PR** with a description that states what changed,
what was tested (with real numbers), and what is still open.

## 6. Reporting back to the owner

- Lead with the result, not the process.
- Show **measured** numbers (`1842ms → 27ms`), not adjectives.
- State clearly what you could **not** verify and why. The unreachable DB means
  some paths genuinely cannot be tested here — say so instead of implying
  coverage you do not have.
- If you added something that was not asked for, say so explicitly and offer to
  remove it.
