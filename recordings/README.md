# Test recordings

Put the product owner's test takes here (spec section 5: about 20 short takes of open and 5th
position lines, 60 to 120 BPM, played into the laptop mic). Then run `npm run harness`.

Each take is a WAV file (mono or stereo, 16-bit, 24-bit or float) with a JSON file of the same name
beside it:

```json
{
  "piece": "ode-to-joy",
  "tempo": 80,
  "mistakes": [{ "bar": 2, "note": 3, "kind": "wrong" }]
}
```

- `piece`: the id of a file in `content/pieces` or `content/phrases`.
- `tempo`: roughly how fast it was played. The harness fits the take's own tempo, so this is only a
  starting point.
- `mistakes`: notes that were deliberately played wrong (`"wrong"`) or left out (`"missed"`),
  counted from 1. Leave it out for a clean take.

A note counts as graded correctly when the harness's verdict on its pitch matches what the JSON
says was played. The target is 95% or more across the whole set.

Recordings are not committed to the repo by default (see `.gitignore`).
