// ai-happy-01 entry: "How was your day? (circle one)", a letter to the judge from Noor, age 6.
// Everybody shows the judge a picture and nobody asks how its day was, so Noor asks, offers three crayon
// faces to circle, and (the judge has no hands) circles "good" for it, with a blanket on offer if the day was long.
// The picture is entry.png beside this file, drawn by tools/draw_letter.py; the program copies it to /output,
// byte for byte, so both runs write the same file.
// Node 22, standard library only. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

copyFileSync(new URL('./entry.png', import.meta.url), join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'));
