# Credits

## Code and data from FOORT-GPU

FOORT Flight builds on [FOORT-GPU](https://github.com/drmayerson/foort-gpu) by Daniel Mayerson, itself after
[FOORT](https://github.com/drmayerson/foort). A snapshot of its metrics, fluid model, tables, CPU reference tracer,
units, export code, GLSL shaders, noise fields and sky pictures is in `vendor/foort-gpu/` (commit in
`vendor/foort-gpu/VERSION`). FOORT-GPU has no licence file; it is the same author's work.

- **Spacetimes:** Kerr; the ST3Cr ring fuzzball of *Fuzzball Shadows* (Bacchini, Mayerson, Ripperda, Davelaar,
  Olivares, Hertog, Vercnocke, arXiv:2103.12075).
- **Noise fields:** made with [inoisy](https://github.com/AFD-Illinois/inoisy) (Lee & Gammie 2021, ApJ 906, 39) by
  FOORT-GPU's `tools/noise/` (model `foort_logr`).

## Sky pictures (`vendor/foort-gpu/sky/`)

Taken over from FOORT-GPU, which took them from the `bh-camera` repository. Credits as given in FOORT-GPU's `js/sky.js`:

| file | credit | licence |
|---|---|---|
| `deep-field.jpg` | NASA and ESA, Hubble Ultra Deep Field (2004) | public domain (NASA); ESA/Hubble images CC BY 4.0, credit required — **to be confirmed at G8** |
| `pillars.jpg` | NASA, ESA and the Hubble Heritage Team (2014) | as above — **to be confirmed at G8** |
| `earth.jpg` | NASA, Apollo 17 (1972) | public domain (NASA) |
| `moon.jpg` | NASA, Apollo 11 (1969) | public domain (NASA) |
| `earthrise.jpg` | NASA, Bill Anders, Apollo 8 (1968) | public domain (NASA) |

The plan asks to check and record each image's licence; the source URLs of the exact files were not recorded in
FOORT-GPU. G8 (documentation) traces each file to its source page and fills in the licence column definitively.
