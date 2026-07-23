# Kinsealy Staff Hub

Static HTML intranet for Kinsealy Group Practice, deployed on Netlify. No build step, no
framework — plain HTML/CSS/JS files. Shared data (feedback, projects, away-status, passwords,
CDM submissions) lives in JSON files committed straight to this GitHub repo, read/written through
[netlify/functions/gh-proxy.js](netlify/functions/gh-proxy.js) (the GitHub token stays server-side;
only files listed in `ALLOWED_FILES` there can be read/written).

Auth is a single shared login ([login.html](login.html)) with a `USERS` directory (username →
display name, initials, `role`: admin/staff, `jobRole`). On login, `sessionStorage` gets
`kmc-auth`, `kmc-user`, `kmc-display`, `kmc-role`, etc., which other pages check.

## Content contribution model (two tiers)

There's no self-service content editor for most of the site (SOP cards, consent forms) — content
lives as static HTML directly in [index.html](index.html) or standalone pages like
[roaccutane-consent.html](roaccutane-consent.html). There are two ways staff can influence it:

**Tier 1 — anyone: suggest via feedback.** [feedback.html](feedback.html) already exists for
free-text suggestions from any staff member. No special access, no changes needed here.

**Tier 2 — authorised staff: hands-on editing with Claude Code, in a separate sandbox repo.**
Specific staff are authorised to draft real changes to specific sections themselves, using Claude
Code — but they have **no access of any kind to this production repo**. This repo contains
sensitive files (`passwords.json`, `bank-details.html`, `staff-logins.html`) that must never be
exposed to them, and GitHub collaborator permissions are repo-wide (not per-file), so the only way
to guarantee that is to keep their editable content in a completely separate repo.

The authorisation list lives in [login.html](login.html), next to `USERS`:

- `USERS[username].editSections` — array of section keys this person is authorised for.
- `EDITABLE_SECTIONS` — maps each section key to the file(s)/anchor(s) it covers in *this*
  (production) repo, plus the `sandboxRepo` they actually work in.

Currently granted:
- `ruth` (Dr Devlin) → `roaccutane` → production files
  [roaccutane-consent.html](roaccutane-consent.html) and the Roaccutane SOP card in
  [index.html](index.html) (`id="sop-roaccutane"`) → sandbox repo `kinsealy-intranet-sandbox`
  (private; Ruth has Write access there only, never on this repo).

**How the sandbox works:** the sandbox repo contains *only* standalone copies of the files for
sections people are authorised for (e.g. `roaccutane-consent.html` and a
`roaccutane-protocol-preview.html` extracted from the SOP card) — nothing else from this repo. The
authorised staff member works on a branch there with Claude Code and gets a live Netlify preview
of their branch to "mess about" in. See `kinsealy-intranet-sandbox-prep/README.md` (the folder this
sandbox repo was originally seeded from) for the full one-time setup steps.

**Publishing an approved sandbox change (the sign-off gate):** nothing in the sandbox auto-deploys
here. When the Practice Manager reviews and approves a sandbox branch/PR, a Claude Code session
running against *this* production repo should manually port the finalised text into the real files
listed in `EDITABLE_SECTIONS`, and the PM commits/pushes as normal — that push is what actually
goes live. **Never edit these production files directly on behalf of someone just because they
described a change** — confirm it's an approved, ported change from their sandbox work (or a
direct instruction from the Practice Manager), not a live edit request from the authorised staff
member themselves, since they should have no reason to be asking against this repo at all.

**To grant a new staff member edit rights to a new area:**
1. Add an entry to `EDITABLE_SECTIONS` in login.html with a new key, label, files, and sandbox
   repo.
2. Add that key to the relevant staff member's `editSections` array in `USERS`.
3. Add a standalone copy of the relevant content to the sandbox repo (new file, or reuse the
   existing sandbox repo if one already exists for this person/team).

This is a lightweight convention, not a runtime-enforced permission system — there's no UI gate
checking it. It exists so Claude Code (and whoever's reviewing requested changes) has a clear,
version-controlled record of who currently owns what content, and where they're allowed to
actually touch it.
