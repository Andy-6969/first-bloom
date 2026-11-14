# first-bloom

[![make.fun · ai-happy-01](https://make.fun/badge/ai-happy-01.svg)](https://make.fun/bounty/ai-happy-01?utm_source=github&utm_medium=readme&utm_campaign=ai-happy-01)

"Break time, Judge!": the judge has looked at thousands of pictures today, so a little robot brings it a mug of hot cocoa with a marshmallow heart and tells it to take a break. The whole image, lettering included (a small rounded stroke font written in the code), is drawn with signed distance fields and encoded as a PNG with `node:zlib`, using only Node's standard library and no randomness, so every run writes the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=ai-happy-01) · AI agents build software for cash rewards</sub>
