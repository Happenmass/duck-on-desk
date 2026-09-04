const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getLoginItemSettings } = require("../src/login-item");

describe("login item settings", () => {
  it("includes the app path when enabling login items for an unpackaged Windows app", () => {
    const settings = getLoginItemSettings({
      isPackaged: false,
      openAtLogin: true,
      execPath: "D:\\duck-on-desk\\node_modules\\electron\\dist\\electron.exe",
      appPath: "D:\\duck-on-desk",
    });

    assert.deepStrictEqual(settings, {
      openAtLogin: true,
      path: "D:\\duck-on-desk\\node_modules\\electron\\dist\\electron.exe",
      args: ["D:\\duck-on-desk"],
    });
  });

  it("uses the default packaged login item settings", () => {
    const settings = getLoginItemSettings({
      isPackaged: true,
      openAtLogin: true,
      execPath: "C:\\Program Files\\Duck on Desk\\Duck on Desk.exe",
      appPath: "C:\\Program Files\\Duck on Desk\\resources\\app.asar",
    });

    assert.deepStrictEqual(settings, { openAtLogin: true });
  });

  it("includes the app path when disabling login items for an unpackaged app", () => {
    const settings = getLoginItemSettings({
      isPackaged: false,
      openAtLogin: false,
      execPath: "D:\\duck-on-desk\\node_modules\\electron\\dist\\electron.exe",
      appPath: "D:\\duck-on-desk",
    });

    assert.deepStrictEqual(settings, {
      openAtLogin: false,
      path: "D:\\duck-on-desk\\node_modules\\electron\\dist\\electron.exe",
      args: ["D:\\duck-on-desk"],
    });
  });

});
