<img width="800" alt="chit-dumps-cropped" src="https://github.com/user-attachments/assets/9183544d-5504-4857-8b54-883630deca41" />

## Full‑Project Snapshot Version Control for LLM Workflows

CHIT Dumps is a deterministic snapshot-based version control system
purpose-built for working with LLMs.

Instead of pasting fragments of code and hoping context isn't lost, CHIT
Dumps lets you transmit your **entire project state** in one compressed,
validated file. Every snapshot is verified against a lifetime changelog,
preventing silent regressions, feature drift, or accidental deletions.

No more:

-   "It worked in the last version..."
-   AI overwriting stable features while fixing unrelated files
-   Hidden drift between versions
-   Partial context misunderstandings

CHIT Dumps guarantees that every change is:

-   Versioned
-   Audited
-   Structurally validated
-   Compared against prior state
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

# Setting up your code and LLM

## Install

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

## Link scripts to project

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

------------------------------------------------------------------------

## Modify .chitconfig 

``` .chitconfig
{
  "name": "dump",
  "validatorMode": "default",
  "checks": {
    "ordering": "strict"
  },
  "filters": {
    "ignore": [],
    "allow": [
      "src/**",
      "package.json",
      ".env"
    ]
  }
}
```

This is the default .chitconfig. At the very least update the allow
list to contain the actual paths to your source files. Take some time
to plan out which files are necessary. The more files you send to the
LLM the longer it takes to process a new version. And could even break
the files if you accidentally add a whole folder of imgs or something.
(Thats the exact reason the ignore list was made and kept optional)

I recommend changing the name too so when you've got multiple projects
running you can tell the dumps apart.

------------------------------------------------------------------------

## Send chit-dump scripts and contract to LLM

Go to your project page and add every file insie chit-dump/

![adding-chit-to-llm](https://github.com/user-attachments/assets/3141667f-ea18-4e6e-9828-229964943dd8)

You'll notice theres also a file called GPT-CONTRACT.txt. This is a
carefully crafted prompt that will lock in the chit-dump logic.

You should see a response like this. Feel free to ask him how the rules work.

<img width="639" height="500" alt="llm-response" src="https://github.com/user-attachments/assets/af8a60dd-4285-48b9-b08d-aa3e39810c82" />

The LLM physically runs the same scripts you do. Reads the same changelog.
Has the same .chitconfig and .repo_state.json

From that point onwards you're ready to make and take some fat dumps.

------------------------------------------------------------------------

# Basic Workflow

## 1) Generate a dump

    npm run dump:generate

Increments the version by one and creates:

    chit-dumps/versions/<name>_v0.0.1.zip

This ZIP contains exactly one file: `dump.txt` - a compressed text file
containing every line of code, log file, and even the dump scripts.

------------------------------------------------------------------------

## 2) Share the ZIP

Upload the ZIP to your LLM, an write a detailed scoped prompt requesting 
the updates you need. Finish with: regen dump. or regen version.

The ZIP is the **authoritative source of truth**.

The AI will use the very same scripts you used to generate and apply
the snapshots to work with the file. Keeping everything  consistent.

After the updates and multiple layers of validation, you'll get the 
next version dump as a download link.

------------------------------------------------------------------------

## 3) Apply a dump file

Once downloaded, put the latest version dump into the chit-dump/versions folder and run:

`npm run dump:apply`

This will:

-   Automatically find newest version #
-   Validate dump structure
-   Validate toolchain version
-   Write repo files
-   Remove stale files
-   Update `state.json`
-   Append to `changelog.json`

Or you could specify the path to the dump file if you prefer:

    npm run dump:apply chit-dumps/versions/<path-to-zip>

### Optional arguments.

  -  `chit-dumps/versions/<name>_vA.B.C.zip`
        Path to snapshot ZIP. Can be used to over-write files

  - `--force`
        Allows apply even if toolchainVersion differs.

Test your code and make sure everything is working. If you get errors,
copy the error message and send it back. (Add the offending file too!)

------------------------------------------------------------------------

## 4) Generate another dump, send it back to the LLM and repeat

    npm run dump:generate
    
    -  `If ran with no arguments, script adds +0.0.1 to version`
       `and generates the dump`

    npm run dump:generate -- --version vX.Y.Z

    ### Arguments:

    -   `--version <vX.Y.Z>`
        Sets the snapshot version. Can be used to overwrite a version`

    -   `--force`
        Overrides toolchainVersion mismatch validation (not recommended).

------------------------------------------------------------------------

# How `.chitconfig` Works

The `.chitconfig` file lives inside the tool folder and defines snapshot
metadata configuration.

It contains:

-   `name` --- canonical project name for snapshot naming
-   Optional configuration flags controlling generation behavior
-   Validation rules for snapshot identity
-   `allow` list. Files/directories you want added to dump [Required]
-   `ignore` list. Paths to ignore. (Optional)

During generation:

-   `meta.name` inside `dump.txt` must match `.chitconfig`
-   Snapshot filenames use the configured name
-   Validation enforces name consistency across versions

This prevents:

-   Cross-project snapshot mixing
-   Accidental version collisions
-   Identity drift between environments

`.chitconfig` acts as the project identity lock.

------------------------------------------------------------------------

CHIT Dumps ensures your LLM workflow becomes structured, enforceable,
and safe --- instead of chaotic and fragile.

AI has greatly increased my productivity. And with chit-dumps versioning,
finally large code-bases stop getting murdered.

# Break out of the fix 1 thing, break 4 things loop!
Let me know what you think of this little project! I hope it helps you too!
