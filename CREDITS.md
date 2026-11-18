# Credits

## FOORT and FOORT-GPU

FOORT Flight builds on [FOORT-GPU](https://github.com/drmayerson/foort-gpu) by Daniel Mayerson, itself after
[FOORT](https://github.com/drmayerson/foort). A snapshot of its metrics, fluid model, tables, CPU reference tracer,
units, export code, GLSL tracer, noise fields and sky pictures is in `vendor/foort-gpu/` (commit in
`vendor/foort-gpu/VERSION`). FOORT-GPU has no licence file; it is the same author's work.

- **Spacetimes:** Kerr; the ST3Cr ring fuzzball of *Fuzzball Shadows: Emergent Horizons from Microstructure*
  (Bacchini, Mayerson, Ripperda, Davelaar, Olivares, Hertog, Vercnocke; arXiv:2103.12075).
- **Noise fields:** made with [inoisy](https://github.com/AFD-Illinois/inoisy) (Lee & Gammie 2021, ApJ 906, 39) by
  FOORT-GPU's `tools/noise/` (model `foort_logr`).
- **Blackbody colours:** CIE 1931 colour matching functions in the multi-lobe Gaussian fit of Wyman, Sloan & Shirley,
  *Simple Analytic Approximations to the CIE XYZ Color Matching Functions*, JCGT 2(2), 2013.
- **Tone map:** the ACES filmic curve in Krzysztof Narkowicz's fit (2016).

## Sky pictures (`vendor/foort-gpu/sky/`)

Taken over from FOORT-GPU, which took them from the `bh-camera` repository; the credit lines are those of both
projects. The exact source pages of the files were not recorded in either project; the terms below are those under
which NASA and ESA/Hubble publish these images, not a check of these particular files.

| file | credit | terms |
|---|---|---|
| `deep-field.jpg` | NASA and ESA, Hubble Ultra Deep Field (2004) | NASA material is not copyrighted (NASA media usage guidelines); ESA/Hubble releases are CC BY 4.0 with the credit line |
| `pillars.jpg` | NASA, ESA and the Hubble Heritage Team (2014) | as above |
| `earth.jpg` | NASA, Apollo 17 (1972) | NASA, not copyrighted |
| `moon.jpg` | NASA, Apollo 11 (1969) | NASA, not copyrighted |
| `earthrise.jpg` | NASA, Bill Anders, Apollo 8 (1968) | NASA, not copyrighted |

The game shows the credit line under the view whenever a picture is the sky.
