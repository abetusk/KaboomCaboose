<!-- SPDX-License-Identifier: CC0-1.0 -->

# Vendored libraries

Pinned copies, committed so the game runs with no network access and no
`npm install` (D13.3). Each keeps its own license file. To update,
download the new tarball with `npm pack NAME@VERSION`, check it, copy the
same files, and update this table.

| Library | Version | License | Tarball sha256 | Files kept |
| --- | --- | --- | --- | --- |
| three | 0.186.1 | MIT (`three/LICENSE`) | `8cd068708ea44f2c73c944b1cead2ba2f0d5c15c8fc194e5700f4e4f4a033fe7` | `build/three.module.js`, `build/three.core.js`, `examples/jsm/` loaders/GLTFLoader, utils/BufferGeometryUtils, utils/SkeletonUtils, controls/OrbitControls, webxr/ARButton, postprocessing/ EffectComposer, RenderPass, UnrealBloomPass, OutputPass, Pass, MaskPass, ShaderPass, shaders/ CopyShader, LuminosityHighPassShader, OutputShader |
| ws | 8.22.0 | MIT (`ws/LICENSE`) | `ca9b3798b2e11ce8fac6713f50ef0501aa12b09b330623c1dc409dff94e7abc8` | `index.js`, `wrapper.mjs`, `lib/` |

Both tarballs were fetched from the npm registry on 2026-11-12. ws has no
required dependencies; its optional native speed-ups (`bufferutil`,
`utf-8-validate`) are not included and are not needed.

The page maps the bare name `three` to `vendor/three/build/three.module.js`
and `three/addons/` to `vendor/three/examples/jsm/` with an import map.
