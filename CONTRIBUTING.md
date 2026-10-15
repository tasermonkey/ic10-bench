You'll still need [Node.js](https://nodejs.org/) 24 or later, probably visual studio code.

```
git clone --recurse-submodules https://github.com/tasermonkey/ic10-bench.git
cd ic10-bench
npm install
npm test
```

The emulator is a git submodule (`vendor/ic10`), so the harness runs against its source. Each
package's CONTRIBUTING.md covers its internals.  This is because its a direct fork of [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10) cleaned up to be ESM and match the current game at the time of this submission.