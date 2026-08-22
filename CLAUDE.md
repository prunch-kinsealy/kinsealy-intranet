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

**Publishing an approved sandbox change (the sign-off gate) — now an in-app approval queue.**
Nothing in the sandbox auto-deploys here, and nothing an authorised staff member submits goes live
on its own. Once they're happy with a draft in the sandbox, they paste the finished HTML into
[propose-edit.html](propose-edit.html) (linked from their nav once `editSections` is non-empty),
which calls [netlify/functions/edits.js](netlify/functions/edits.js) to store it as a `pending`
entry in `pending-edits.json`. The Practice Manager (or another `admin`) reviews it on
[approvals.html](approvals.html) — which shows the current live content next to the proposal — and
clicks Approve or Reject. **Approval is what actually publishes it**: `edits.js` writes the
approved content straight into the target production file (a full-file overwrite for
`mode:'whole'` targets like `roaccutane-consent.html`, or a splice between that section's
`<!-- SYNC:<marker>-BODY:START/END -->` HTML comment markers for `mode:'anchor'` targets like the
Roaccutane SOP card in `index.html`) — no separate commit/push step needed. Rejection just records
a note the submitter sees on their own propose-edit.html page. This *is* enforced server-side,
unlike the rest of this convention: `edits.js` checks the submitter's `editSections` grant and the
reviewer's `admin` role from their signed session token before touching anything, not from
client-supplied data. Admins also get an in-app-only notification — a "🔔 N pending" badge in
index.html's topbar and nav — the moment something's waiting on them; there's no email involved.

A Claude Code session should still only touch the production files listed in `EDITABLE_SECTIONS`
directly (bypassing propose-edit.html/approvals.html) on a **direct instruction from the Practice
Manager** — e.g. an urgent fix she wants ported immediately. **Never edit these production files on
behalf of someone just because they described a change** — a live edit request from the authorised
staff member themselves should be redirected to propose-edit.html, since they have no reason to be
asking against this repo at all.

**To grant a new staff member edit rights to a new area:**
1. Add an entry to `EDITABLE_SECTIONS` in login.html with a new key, label, `files` (display
   strings), sandbox repo, and a `targets` array (the machine-readable `{file, mode, marker?}` list
   `propose-edit.html` and `edits.js` actually use — see the comment above `EDITABLE_SECTIONS` in
   login.html).
2. Add that key to the relevant staff member's `editSections` array in `USERS`.
3. Mirror both the grant and the targets into `EDIT_GRANTS` / `EDIT_TARGETS` at the top of
   `netlify/functions/edits.js` — this is the copy that's actually enforced, so it must match
   login.html by hand (Netlify functions can't import from an HTML file).
4. If a target uses `mode:'anchor'`, wrap the relevant block in the production file with
   `<!-- SYNC:<MARKER>-BODY:START -->` / `<!-- SYNC:<MARKER>-BODY:END -->` comments (see the
   Roaccutane SOP card in index.html) so `edits.js` knows what to replace on approval.
5. Add a standalone copy of the relevant content to the sandbox repo (new file, or reuse the
   existing sandbox repo if one already exists for this person/team).

The `EDITABLE_SECTIONS`/`editSections` grant itself is still a lightweight, version-controlled
convention rather than something the UI enforces (any page can be reached by URL regardless of nav
visibility) — but what happens with that grant once someone acts on it (submitting or reviewing an
edit) *is* checked server-side in `edits.js`, and nothing reaches the live site without a signed-in
admin explicitly approving it there.
