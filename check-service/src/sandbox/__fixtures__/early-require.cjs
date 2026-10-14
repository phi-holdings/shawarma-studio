// Test fixture (sandbox.test.ts): preloaded with --require BEFORE harden.mjs, it keeps a createRequire()
// function made before the sandbox hooks exist, to prove those hooks still govern it afterwards.
globalThis.earlyRequire = require('node:module').createRequire(__filename);
