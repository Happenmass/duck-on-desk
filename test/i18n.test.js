"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { i18n, SUPPORTED_LANGS } = require("../src/i18n");

const ROOT = path.join(__dirname, "..");

function placeholders(value) {
  return Array.from(String(value).matchAll(/\{[^}]+\}/g), (m) => m[0]).sort();
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertLocaleObjectParity(locales, label) {
  const baseKeys = Object.keys(locales.en);
  for (const lang of SUPPORTED_LANGS) {
    assert.ok(locales[lang], `missing ${label} locale: ${lang}`);
    assert.deepStrictEqual(Object.keys(locales[lang]), baseKeys, `${label} locale keys/order mismatch: ${lang}`);
    for (const key of baseKeys) {
      assert.strictEqual(typeof locales[lang][key], typeof locales.en[key], `${label}.${lang}.${key} type mismatch`);
      if (typeof locales.en[key] === "string") {
        assert.deepStrictEqual(
          placeholders(locales[lang][key]),
          placeholders(locales.en[key]),
          `${label}.${lang}.${key} placeholder mismatch`
        );
      } else if (typeof locales.en[key] === "function") {
        assert.strictEqual(
          locales[lang][key].length,
          locales.en[key].length,
          `${label}.${lang}.${key} function arity mismatch`
        );
      }
    }
  }
}

function loadSettingsI18nStrings() {
  const source = fs.readFileSync(path.join(ROOT, "src", "settings-i18n.js"), "utf8");
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.DuckSettingsI18n.STRINGS;
}

function loadBubbleStrings() {
  const source = fs.readFileSync(path.join(ROOT, "src", "bubble-renderer.js"), "utf8");
  const match = source.match(/const BUBBLE_STRINGS = (\{[\s\S]*?\n\});/);
  assert.ok(match, "bubble-renderer.js should define BUBBLE_STRINGS");
  const context = {};
  vm.runInNewContext(`result = ${match[1]};`, context);
  return context.result;
}

// Renderers outside the settings window resolve t() against src/i18n.js, and t() falls
// back to returning the key itself, so a string filed under settings-i18n.js by mistake
// renders its own name into the UI instead of failing loudly.
function runtimeDictRenderers() {
  const dir = path.join(ROOT, "src");
  const renderers = new Set();
  for (const html of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const markup = fs.readFileSync(path.join(dir, html), "utf8");
    const scripts = Array.from(markup.matchAll(/<script[^>]+src="\.?\/?([^"]+\.js)"/g), (m) => m[1]);
    if (scripts.includes("settings-i18n.js")) continue;
    for (const script of scripts) {
      const file = path.join(dir, script);
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      if (/function t\(key\)/.test(source) && /getI18n\(/.test(source)) renderers.add(script);
    }
  }
  return Array.from(renderers);
}

describe("i18n locales", () => {
  it("lists all selectable languages in supported languages", () => {
    assert.deepStrictEqual(SUPPORTED_LANGS, ["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"]);
  });

  it("keeps all locale keysets aligned with English", () => {
    assertLocaleObjectParity(i18n, "runtime");
  });

  it("keeps native startup health notices in the runtime dictionary", () => {
    const keys = [
      "prefsReadFailureNudgeTitle",
      "prefsReadFailureNudgeBody",
      "prefsRecoveredNudgeTitle",
      "prefsRecoveredNudgeBody",
    ];
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        assert.strictEqual(typeof i18n[lang][key], "string", `${lang}.${key} should exist`);
        assert.notStrictEqual(i18n[lang][key], key, `${lang}.${key} must not render as its key`);
      }
    }
  });

  it("uses the requested Simplified Chinese desktop-pet recovery wording", () => {
    assert.strictEqual(i18n.zh.bringPetToPrimaryDisplay, "将桌宠拉回主屏");
  });

  it("keeps Settings locale keysets aligned with English", () => {
    assertLocaleObjectParity(loadSettingsI18nStrings(), "settings");
  });

  it("keeps the Agents catalog title free of detection claims in every locale", () => {
    const strings = loadSettingsI18nStrings();
    assert.deepStrictEqual(
      Object.fromEntries(SUPPORTED_LANGS.map((lang) => [lang, strings[lang].agentSectionUnavailable])),
      {
        en: "More supported tools",
        zh: "其他支持的工具",
        "zh-TW": "其他支援的工具",
        ko: "지원되는 기타 도구",
        ja: "その他の対応ツール",
        "pt-BR": "Outras ferramentas compatíveis",
        es: "Otras herramientas compatibles",
      }
    );
    // The sibling section IS a detection claim and must keep saying so.
    for (const lang of SUPPORTED_LANGS) {
      assert.notStrictEqual(
        strings[lang].agentSectionUnavailable,
        strings[lang].agentSectionRecommended,
        `${lang}: catalog and detected-locally titles must stay distinct`
      );
    }
  });

  it("provides non-empty macOS menu bar and Dock recovery strings in every Settings locale", () => {
    const settings = loadSettingsI18nStrings();
    const keys = [
      "rowShowInMenuBar",
      "rowShowInMenuBarDesc",
      "rowShowInDock",
      "rowShowInDockDesc",
    ];
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        assert.strictEqual(typeof settings[lang][key], "string", `settings.${lang}.${key} should be a string`);
        assert.ok(settings[lang][key].trim(), `settings.${lang}.${key} should not be empty`);
      }
    }
  });

  it("keeps permission bubble locale keysets aligned with English", () => {
    assertLocaleObjectParity(loadBubbleStrings(), "bubble");
  });

  it("keeps main-process Settings dialog strings available for every supported language", () => {
    const settingsIpcSource = fs.readFileSync(path.join(ROOT, "src", "settings-ipc.js"), "utf8");
    const animationOverridesSource = fs.readFileSync(
      path.join(ROOT, "src", "settings-animation-overrides-main.js"),
      "utf8"
    );
    for (const [name, source] of [
      ["SOUND_OVERRIDE_DIALOG_STRINGS", settingsIpcSource],
      ["ANIMATION_OVERRIDES_EXPORT_DIALOG_STRINGS", animationOverridesSource],
      ["REMOVE_THEME_DIALOG_STRINGS", settingsIpcSource],
    ]) {
      const start = source.indexOf(`const ${name} = {`);
      assert.notStrictEqual(start, -1, `missing ${name}`);
      const end = source.indexOf("\n};", start);
      assert.notStrictEqual(end, -1, `unterminated ${name}`);
      const block = source.slice(start, end);
      for (const lang of SUPPORTED_LANGS) {
        const escapedLang = regexEscape(lang);
        assert.match(block, new RegExp(`\\n\\s*(?:"${escapedLang}"|${escapedLang}):`), `${name} missing ${lang}`);
      }
    }
  });

  it("keeps every renderer t(\"key\") literal resolvable in the runtime locale", () => {
    const renderers = runtimeDictRenderers();
    for (const known of ["session-hud-renderer.js", "dashboard-renderer.js"]) {
      assert.ok(renderers.includes(known), `renderer discovery missed ${known}`);
    }
    for (const file of renderers) {
      const source = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
      // the lookbehind drops method calls like obj.t("x")
      const keys = new Set(
        Array.from(source.matchAll(/(?<![\w$.])t\(\s*"([A-Za-z0-9_]+)"\s*\)/g), (m) => m[1])
      );
      // a key picked by a ternary reaches t() as t(tipKey), never as a literal, so pull the
      // strings out of any *Key identifier that t() is actually called with
      for (const [, ident, rhs] of source.matchAll(/\b(\w+Key)\b\s*=\s*([^;]+);/g)) {
        if (!new RegExp(`(?<![\\w$.])t\\(\\s*${ident}\\s*\\)`).test(source)) continue;
        for (const [, key] of rhs.matchAll(/"([A-Za-z0-9_]+)"/g)) keys.add(key);
      }
      assert.ok(keys.size, `${file} should call t() with literal keys`);
      for (const key of keys) {
        assert.ok(key in i18n.en, `${file}: i18n key "${key}" is missing from src/i18n.js`);
      }
    }
  });

  // Keys reached through a lookup table (t(entry.key)) are invisible to the scan above, so
  // rather than trace dataflow, treat any Settings-only key name appearing in a runtime
  // renderer as misfiled. Keys resolved purely at runtime from main-process payloads never
  // appear as literals here, so they stay out of scope.
  it("keeps renderers clear of keys that only exist in the Settings locale", () => {
    const settings = loadSettingsI18nStrings();
    for (const file of runtimeDictRenderers()) {
      const source = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
      const literals = new Set(Array.from(source.matchAll(/"([A-Za-z][A-Za-z0-9_]{2,})"/g), (m) => m[1]));
      for (const literal of literals) {
        if (literal in settings.en && !(literal in i18n.en)) {
          assert.fail(`${file}: "${literal}" resolves only in settings-i18n.js, which this window never loads`);
        }
      }
    }
  });

  // Parity passes on "1 ativas" — the key and the placeholder are both there,
  // only the grammar is wrong. Portuguese inflects for number, so these pin the
  // rendered text at 1 and at N.
  it("inflects pt-BR count strings whose locale entry is a function", () => {
    const pt = loadSettingsI18nStrings()["pt-BR"];

    assert.strictEqual(pt.doctorAgentSummaryAttention(1), "1 precisa de atenção");
    assert.strictEqual(pt.doctorAgentSummaryAttention(4), "4 precisam de atenção");
    assert.strictEqual(pt.doctorAgentSummarySkipped(1), "1 ignorado");
    assert.strictEqual(pt.doctorAgentSummarySkipped(4), "4 ignorados");

    const oneOfEach = pt.toastCodexPetsRefreshOk(1, 1, 1, 1, 1, false);
    assert.match(oneOfEach, /1 novo, 1 atualizado, 1 sem mudança, 1 removido, 1 inválido/);
    const manyOfEach = pt.toastCodexPetsRefreshOk(2, 2, 2, 2, 2, false);
    assert.match(manyOfEach, /2 novos, 2 atualizados, 2 sem mudança, 2 removidos, 2 inválidos/);

    assert.match(pt.toastAnimOverridesExportOk(1, "/tmp/o.json"), /\b1 tema\b/);
    assert.match(pt.toastAnimOverridesExportOk(2, "/tmp/o.json"), /\b2 temas\b/);
    assert.match(pt.toastAnimOverridesImportOk(1), /\b1 tema\b/);
    assert.match(pt.toastAnimOverridesImportOk(2), /\b2 temas\b/);
  });

  it("keeps pt-BR count strings number-invariant where the locale entry is a plain string", () => {
    const settings = loadSettingsI18nStrings()["pt-BR"];
    const runtime = i18n["pt-BR"];

    // [template, placeholder, rendered at 1, rendered at 4]
    const cases = [
      [runtime.dashboardCount, "{n}", "1 em atividade", "4 em atividade"],
      [runtime.sessionHudActive, "{n}", "1 em atividade", "4 em atividade"],
      [runtime.sessionHudOtherActive, "{n}", "mais 1 em atividade", "mais 4 em atividade"],
      [settings.doctorIssueCount, "{count}", "1 problema(s)", "4 problema(s)"],
    ];
    for (const [template, placeholder, one, many] of cases) {
      assert.strictEqual(template.replace(placeholder, "1"), one);
      assert.strictEqual(template.replace(placeholder, "4"), many);
    }

    // Counted toasts: the participle must not commit to a number.
    for (const [template, tokens] of [
      [settings.toastAgentInstallHintPartial, ["{success}", "{failed}"]],
      [settings.toastAgentCleanupHintPartial, ["{success}", "{failed}"]],
      [settings.toastAgentInstallHintPartialSkipped, ["{success}"]],
    ]) {
      let rendered = template;
      for (const token of tokens) rendered = rendered.replace(token, "1");
      assert.match(rendered, /\(s\)/, `expected invariant wording at a count of 1: ${rendered}`);
    }

    // Appended after a name list that can hold a single agent.
    assert.strictEqual(settings.doctorAgentSummaryNeedsAttention, "precisa(m) de atenção");
  });

  it("keeps Spanish runtime count strings grammatical at one and many", () => {
    const es = i18n.es;
    const cases = [
      [es.dashboardCount, "1 en actividad", "4 en actividad"],
      [es.sessionHudActive, "1 en actividad", "4 en actividad"],
      [es.sessionHudOtherActive, "1 más en actividad", "4 más en actividad"],
    ];
    for (const [template, one, many] of cases) {
      assert.strictEqual(template.replace("{n}", "1"), one);
      assert.strictEqual(template.replace("{n}", "4"), many);
    }
  });

  it("inflects Spanish Settings count strings", () => {
    const es = loadSettingsI18nStrings().es;
    assert.strictEqual(es.doctorAgentSummaryAttention(1), "1 requiere atención");
    assert.strictEqual(es.doctorAgentSummaryAttention(4), "4 requieren atención");
    assert.strictEqual(es.doctorAgentSummarySkipped(1), "1 omitido");
    assert.strictEqual(es.doctorAgentSummarySkipped(4), "4 omitidos");

    const oneOfEach = es.toastCodexPetsRefreshOk(1, 1, 1, 1, 1, false);
    assert.match(oneOfEach, /1 nuevo, 1 actualizado, 1 sin cambios, 1 eliminado, 1 inválido/);
    const manyOfEach = es.toastCodexPetsRefreshOk(2, 2, 2, 2, 2, false);
    assert.match(manyOfEach, /2 nuevos, 2 actualizados, 2 sin cambios, 2 eliminados, 2 inválidos/);
  });

  it("keeps Spanish plain count strings number-invariant", () => {
    const es = loadSettingsI18nStrings().es;
    assert.strictEqual(es.doctorIssueCount.replace("{count}", "1"), "Problemas: 1");
    assert.strictEqual(es.doctorIssueCount.replace("{count}", "4"), "Problemas: 4");

    for (const [template, one, many] of [
      [es.toastAgentInstallHintPartialSkipped, "Instalaciones completadas: 1.", "Instalaciones completadas: 4."],
      [es.toastAgentInstallHintPartial, "Instalaciones completadas: 1; con error: 1.", "Instalaciones completadas: 4; con error: 4."],
      [es.toastAgentCleanupHintPartial, "Eliminaciones completadas: 1; con error: 1.", "Eliminaciones completadas: 4; con error: 4."],
    ]) {
      const render = (count) => template
        .replace("{success}", String(count))
        .replace("{failed}", String(count));
      assert.match(render(1), new RegExp(`^${regexEscape(one)}`));
      assert.match(render(4), new RegExp(`^${regexEscape(many)}`));
    }

    assert.strictEqual(
      es.toastAgentInstallHintPartialSkipped
        .replace("{success}", "1")
        .replace("{agents}", "Codex y OpenCode"),
      "Instalaciones completadas: 1. No se encontró instalación local de Codex y OpenCode."
    );
  });

  it("keeps Spanish Settings copy aligned with product semantics changed since the original locale contribution", () => {
    const es = loadSettingsI18nStrings().es;
    const expected = {
      sidebarAnimOverrides: "Animación y sonido",
      agentsSubtitle: "Descubre automáticamente herramientas de IA en este equipo y en WSL, o añade manualmente una IA que Duck aún no incluya. Una vez conectada, gestiona aquí su estado, sus solicitudes de permiso y sus notificaciones.",
      shortcutLabelPetReveal: "Clic en la mascota: Mostrar superposiciones de la mascota",
      bubbleNotificationDesc: "El interruptor controla los avisos pasivos de Codex. Los segundos fijan el límite máximo de cierre automático; estados de sesión posteriores pueden descartarlo antes. 0 los oculta.",
      langChinese: "简体中文",
      langTraditionalChinese: "繁體中文",
      themeSubtitle: "Elige y personaliza tu mascota de escritorio.",
      animOverridesTitle: "Animación y sonido",
    };
    for (const [key, value] of Object.entries(expected)) {
      assert.strictEqual(es[key], value, key);
    }
  });

  it("keeps Codex Pet main dialog strings available for every supported language", () => {
    const source = fs.readFileSync(path.join(ROOT, "src", "codex-pet-main.js"), "utf8");
    for (const name of ["getImportDialogStrings", "getRemovalDialogStrings"]) {
      const start = source.indexOf(`function ${name}()`);
      assert.notStrictEqual(start, -1, `missing ${name}`);
      const end = source.indexOf("\n  async function", start);
      assert.notStrictEqual(end, -1, `unterminated ${name}`);
      const block = source.slice(start, end);
      for (const lang of SUPPORTED_LANGS) {
        const escapedLang = regexEscape(lang);
        assert.match(block, new RegExp(`\\n\\s*(?:"${escapedLang}"|${escapedLang}):`), `${name} missing ${lang}`);
      }
    }
  });
});
