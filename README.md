# CHIT Dumps v2.5.0

## Full‑Project Snapshot Version Control for LLM Workflows

CHIT Dumps is a deterministic snapshot-based version control system
purpose-built for working with LLMs.

Instead of pasting fragments of code and hoping context isn't lost, CHIT
Dumps lets you transmit your **entire project state** in one compressed,
validated file. Every snapshot is verified against a lifetime changelog,
preventing silent regressions, feature drift, or accidental deletions.

No more:

-   "It worked in the last version..."\
-   AI overwriting stable features while fixing unrelated files\
-   Hidden drift between versions\
-   Partial context misunderstandings

CHIT Dumps guarantees that every change is:

-   Versioned\
-   Audited\
-   Structurally validated\
-   Compared against prior state\
-   Deterministically restorable

This system ensures ChatGPT (or any LLM) won't build you a castle and
then burn it down in the next update while changing a font on a
completely different page.

CHIT-DUMPS runs using two primary scripts:

-   `dump-generate.js`
-   `dump-apply.js`

Everything else --- internal state, version history, and changelogs ---
lives inside the `chit-dumps/` folder.

Nothing pollutes your project root.

------------------------------------------------------------------------

# Installation

Place the `chit-dumps/` folder in your project root:

    your-project/
      package.json
      chit-dumps/
        dump-generate.js
        dump-apply.js
        dump-validator.js
        dump-undo.js
        print-active.js
        versions/
        changelog.json
        state.json

------------------------------------------------------------------------

# Linking It Into Your Project

Add this to your root `package.json`:

``` json
"scripts": {
  "dump:generate": "node ./chit-dumps/dump-generate.js",
  "dump:apply": "node ./chit-dumps/dump-apply.js",
  "dump:validate": "node ./chit-dumps/dump-validator.js",
  "dump:active": "node ./chit-dumps/print-active.js",
  "dump:undo": "node ./chit-dumps/dump-undo.js"
}
```

All you need to do is call:

``` bash
npm run dump:<apply/generate>
```

Both files can be called without a filepath or source. They will
discover the correct file.

------------------------------------------------------------------------

# Basic Workflow

## 1) Generate a snapshot ZIP

    npm run dump:generate -- --version v2.5.0

Creates:

    chit-dumps/versions/<name>_v2.5.0.zip

This ZIP contains exactly one file: `dump.txt` (CHITDUMPv2 format).

------------------------------------------------------------------------

## 2) Share the ZIP

Upload the ZIP to your LLM, collaborator, or automation system.

The ZIP is the **authoritative source of truth**.

------------------------------------------------------------------------

## 3) Write your update prompt

Write a detailed description of what you want added or fixed 
for your next version. Try to keep the scope limited per update

------------------------------------------------------------------------

## 3) Apply a snapshot ZIP

    npm run dump:apply -- chit-dumps/versions/<name>_v2.5.0.zip

This will:

-   Validate dump structure
-   Validate toolchain version
-   Write repo files
-   Remove stale files
-   Update `state.json`
-   Append to `changelog.json`

## dump-generate

    npm run dump:generate
    
    -  `If ran with no arguments, script adds +0.0.1 to version`\
       `and generates the dump`

    npm run dump:generate -- --version vX.Y.Z

    ### Arguments:

    -   `--version <vX.Y.Z>`\
        Sets the snapshot version. Can be used to overwrite a version`

    -   `--force`\
        Overrides toolchainVersion mismatch validation (not recommended).

------------------------------------------------------------------------

## dump-apply

    npm run dump:apply -- <path-to-zip>

    ### Arguments:

    -   `<path-to-zip>`\
        Required. Path to snapshot ZIP.

    -   `--force`\
        Allows apply even if toolchainVersion differs.

------------------------------------------------------------------------

## dump-validate

    npm run dump:validate -- <path-to-zip>

    ### Arguments:

    -   `<path-to-zip>`\
        `Required. Validates structure without applying.`

------------------------------------------------------------------------

## dump-active

    npm run dump:active

No arguments. Displays current active version metadata.

------------------------------------------------------------------------

# How `.chitconfig` Works

The `.chitconfig` file lives inside the tool folder and defines snapshot
metadata configuration.

It typically contains:

-   `dumpName` --- canonical project name for snapshot naming
-   Optional configuration flags controlling generation behavior
-   Validation rules for snapshot identity

During generation:

-   `meta.dumpName` inside `dump.txt` must match `.chitconfig`
-   Snapshot filenames use the configured name
-   Validation enforces name consistency across versions

This prevents:

-   Cross-project snapshot mixing
-   Accidental version collisions
-   Identity drift between environments

`.chitconfig` acts as the project identity lock.

------------------------------------------------------------------------

# Important Design Rules

-   All state lives inside `chit-dumps/`
-   Snapshots are single-file ZIPs
-   No multi-file ZIPs allowed
-   Validation occurs before apply
-   Changelog is append-only
-   Active state must match changelog history
-   Version bump required on every change

------------------------------------------------------------------------

# Why Use CHIT Dumps?

-   Deterministic full-project snapshots\
-   LLM-safe workflows\
-   No Git required\
-   Automatic stale file cleanup\
-   Append-only audit logging\
-   Toolchain-enforced integrity\
-   Zero root pollution\
-   Designed for long-running AI-assisted projects

------------------------------------------------------------------------

CHIT Dumps ensures your LLM workflow becomes structured, enforceable,
and safe --- instead of chaotic and fragile.
