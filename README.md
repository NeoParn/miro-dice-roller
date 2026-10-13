# Miro Dice Roller

A dice roller that lives in a Miro board's sidebar. Rolls appear in a shared Dice Tray on the board, with the last nine rolls underneath, and every roll is logged with a timestamp to a Google Sheet.

**Adding or changing a game:** see [games/README.md](games/README.md). Game files are the only part you need to touch.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `index.html` | GitHub Pages | Miro's entry point; opens the panel when the toolbar icon is clicked |
| `panel.html` + `panel.bundle.js` | GitHub Pages | The sidebar panel (`panel.bundle.js` is built from the files below) |
| `games/*.js`, `games/list.js` | GitHub Pages | One file per game, loaded directly by the panel, so no build is needed |
| `engine.js` | | Dice: pools, explode, reroll, keep/drop, expressions like `4d6kh3` |
| `rules.js` | | Reads game files: inputs, references, totals, flags, the checker |
| `app.js` | | The panel UI, built from the board's game file |
| `backend-miro.js` | | Miro user, Dice Tray, board's game choice, Google Sheet calls |
| `backend.js` | | Standalone test mode (everything in the browser) |
| `config.js` | | The Google Sheet script URL |
| `apps-script/Code.gs` | The sheet's Apps Script | Characters tab, Log tab |

## Working on the code

```
node test.js                     # dice, rules, both games, the guide's example
node test/apps-script.test.js    # the sheet script against a fake spreadsheet
node build.js                    # rebuild panel.bundle.js and dist/panel-standalone.html
```

`dist/panel-standalone.html` opens straight from disk for trying things without Miro.
