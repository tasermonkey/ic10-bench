# @tasermonkey/ic10-link

Links the IC10 scripts in your project to the chips in your Stationeers game, so you can edit,
test and commit them in your editor and have them show up in game.

It works with the [IC10Sync mod](https://github.com/semoro/stationeers.ic10sync) (a version that
puts each station's chips in their own folder), which writes every chip's code to
`chipdata/<station>/<label> [<id>].ic10` and loads the file back into the chip when it changes.
`stations/<station>.json` in your project says which chip runs which of your scripts.

`ic10-link watch` sends each script you save to the chips that run it, once it passes lint and its
tests, and copies a chip you edit in game back to its script, so git shows the change.

```
$ npx ic10-link status
Station: Real Creative For Testing
  chips: D:\OneDrive\Documents\My Games\Stationeers\chipdata\Real Creative For Testing
  map:   stations/Real Creative For Testing.json

Mapped:
  [451] Lights -> ic10/EControl/Room Lights.ic10: same

Not mapped:
  [450] Script1: 18 lines
```

A chip relabelled in game leaves its old file behind; `status` asks which file is current and
deletes the others. See [REFERENCE.md](REFERENCE.md) for the commands and the map's format.
