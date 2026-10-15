You'll still need [Node.js](https://nodejs.org/) 24 or later, probably visual studio code.

If you want a lot of details read the [AGENTS.md](./AGENTS.md) file.

Feel free to add more linting rules, or adjusting current ones.  Like I know the idle yield check is not perfect, I do not know how to test that statically.  However, it works well enough for me, to mostly find the ones I forget to yield, so I figured it can help AI 'remember' to yield.

I just want to be able to ignore rules on certain files, so keep the ignore logic up to date as well.