"use strict";
// Every privileged scheme in the app, registered in ONE call.
//
// protocol.registerSchemesAsPrivileged() is not additive. Measured on Electron
// 41.10.7, calling it twice leaves the accumulated `standard` list intact but
// REPLACES the secure / fetch / cors lists, so the schemes from the first call
// silently lose those privileges:
//
//   standard-schemes = pet-model,pet-market
//   secure-schemes   = pet-market          <- pet-model dropped
//   fetch-schemes    = pet-market          <- pet-model dropped
//   cors-schemes     = pet-market          <- pet-model dropped
//
// Nothing throws; the pet renderer simply stops being able to fetch its ONNX
// policies and never appears. Adding a scheme therefore means adding it to this
// list, never calling registerSchemesAsPrivileged() a second time.
const petModel = require("../robots/duck/pet-model-protocol");
const petMarket = require("../market/media-protocol");

const PRIVILEGED_SCHEMES = [petModel.PRIVILEGED_SCHEME, petMarket.PRIVILEGED_SCHEME];

// Call before app.whenReady(); each module installs its own handler inside it.
function registerPrivilegedSchemes(protocol) {
  protocol.registerSchemesAsPrivileged(PRIVILEGED_SCHEMES);
}

module.exports = { PRIVILEGED_SCHEMES, registerPrivilegedSchemes };
