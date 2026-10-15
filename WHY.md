# Why I built this

> Every Stationeer has a story about the divide by zero that turned their base into a fireball.

More and more players are using AI to write their IC10 scripts, and AI does much better when it can
quickly test the code it writes. I wanted a testing framework for IC10 that gives it that: these
tests run with `npm test`, with no game needed, so an AI assistant can write a script, test it and
fix it on its own. And when a test fails, the
[VS Code debugger](https://github.com/tasermonkey/ic10-bench/tree/main/packages/vscode#readme) lets
you step through the script line by line and see exactly what it did.

I built it against my own scripts, and with the emulator and the tests, the AI found bugs in IC10
code I'd been running in game. Some of them explained strange behaviour I'd seen and never tracked
down: a suit controller switching its filtration on and off over and over, and a fabricator
controller that only noticed some of its button presses (it checked one fabricator's buttons each
tick, so it missed presses on the others). With a failing test for each, they were quick to fix.

Testing in game is slow. You build the setup, wait for the right conditions (night, a low battery,
a full tank), and watch. Most cases never get tried, and when something goes wrong you rarely see
why. A test sets up those conditions in a few lines and checks the result in milliseconds. It runs
every time you change the script, so a fix for one thing can't quietly break another, and it says
what the script is supposed to do, for the next person who reads it, or for you in six months.
Writing the test first, so it fails until the script is right, is a good way to fix a bug and
know it's fixed.

My hope is that IC10 Bench makes that cheap enough to be worth doing for IC10: that players, and
the AI tools they use, write tests alongside their scripts, catch bugs before they cause a base to
explode, and share scripts that come with proof they work.
