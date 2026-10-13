# Miro Dice Roller — step 2: engine + Fabula Ultima config

Files
- engine.js — game-agnostic dice: rollDie, rollDice, parseExpression ("2d6+3"), rollExpression, facesFor (test helper)
- games/fabula-ultima.js — Fabula Ultima config: check, attack/damage, any-dice; crit/fumble rules; summarize() one-liners
- test.js — 18 tests. Run with: node test.js

Rules encoded for Fabula Ultima
- Check: two attribute dice (d6/d8/d10/d12), sum + modifier. HR = higher die.
- Crit: both dice show the same face and that face is 6 or higher.
- Fumble: both dice show 1.
- Attack: same roll as a check, plus damage = HR + weapon damage, with a damage type.
- Any dice: free-form expression like 3d6, d20+2, 2d8+1d6-1.

Result object shape (what the tray and the log will receive)
{ type, label, dice: [{size, face}], modifier, total, hr, crit, fumble, damage?, damageType?, note }

Adding a game later = add games/<name>.js with the same { id, name, rolls: { ... } } shape.

# Step 3: panel UI (standalone test mode)

Open dist/panel-standalone.html in any browser. No server needed.
- First open asks for your name (stands in for the Miro login).
- Create a character: name, four attribute dice, weapon damage + type. Saved in that browser.
- Check / Attack / Any dice tabs. Attribute buttons show the character's current die.
- Tray preview shows the last roll; session log below it; CSV exports the session.

Files
- panel.html — the page shell + styles (loads app.js as a module; this is what GitHub Pages serves)
- app.js — the UI
- backend.js — adapter the UI talks to. Standalone version uses the browser's local storage.
  The Miro + Google Sheet version will replace this file and nothing else.
- build.js — `node build.js` bundles everything into dist/panel-standalone.html
