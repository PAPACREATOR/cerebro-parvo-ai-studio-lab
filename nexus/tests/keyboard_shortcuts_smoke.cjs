"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const code = fs.readFileSync(path.join(__dirname, "..", "ui", "app.js"), "utf8");

async function testShortcuts() {
  const els = new Map();
  const listeners = new Map();
  const clicks = new Map();

  const node = id => {
    if (!els.has(id)) {
      els.set(id, {
        value: "",
        files: [],
        hidden: false,
        disabled: false,
        open: false,
        checked: false,
        textContent: "",
        replaceChildren() {},
        append() {},
        focus() { clicks.set(id + ":focus", (clicks.get(id + ":focus") || 0) + 1); },
        reset() { this.value = ""; },
        addEventListener(type, callback) { listeners.set(id + ":" + type, callback); },
        click() { clicks.set(id + ":click", (clicks.get(id + ":click") || 0) + 1); },
        showModal() { this.open = true; },
        close() { this.open = false; }
      });
    }
    return els.get(id);
  };

  const windowListeners = new Map();
  const ctx = {
    document: {
      getElementById: node,
      addEventListener(type, cb) { windowListeners.set(type, cb); }
    },
    window: {
      addEventListener(type, cb) { windowListeners.set(type, cb); }
    },
    location: { hash: "" },
    history: { replaceState() {} },
    sessionStorage: { getItem() { return "s"; }, setItem() {} },
    URLSearchParams,
    Uint8Array,
    btoa: v => Buffer.from(v, "binary").toString("base64"),
    clearTimeout() {},
    setTimeout() { return 1; },
    fetch: async () => ({ ok: true, json: async () => [] })
  };

  vm.runInNewContext(code, ctx, { filename: "nexus/ui/app.js" });

  const onKeydown = windowListeners.get("keydown");
  assert.ok(typeof onKeydown === "function", "keydown handler must be registered");

  // Test 1: Ctrl+N triggers el("new").click()
  let prevented = false;
  onKeydown({ ctrlKey: true, key: "n", preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "Ctrl+N should call preventDefault");
  assert.equal(clicks.get("new:click"), 1, "Ctrl+N should click #new");

  // Test 2: Ctrl+Enter triggers el("submit").click()
  prevented = false;
  onKeydown({ ctrlKey: true, key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "Ctrl+Enter should call preventDefault");
  assert.equal(clicks.get("submit:click"), 1, "Ctrl+Enter should click #submit");

  // Test 3: Ctrl+Enter with execution-confirmation dialog open clicks #execution-approve
  const execDialog = node("execution-confirmation");
  execDialog.open = true;
  prevented = false;
  onKeydown({ ctrlKey: true, key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(clicks.get("execution-approve:click"), 1, "Ctrl+Enter should click #execution-approve when dialog open");
  execDialog.open = false;

  // Test 4: Ctrl+Enter with approval dialog open clicks #approve
  const appDialog = node("approval");
  appDialog.open = true;
  prevented = false;
  onKeydown({ ctrlKey: true, key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(clicks.get("approve:click"), 1, "Ctrl+Enter should click #approve when dialog open");
  appDialog.open = false;

  // Test 5: Cmd (metaKey) support for macOS
  prevented = false;
  onKeydown({ metaKey: true, key: "n", preventDefault() { prevented = true; } });
  assert.equal(clicks.get("new:click"), 2, "Cmd+N should also click #new");

  console.log("PASS: Global keyboard shortcuts (Ctrl+Enter, Ctrl+N, dialog confirm, macOS Cmd)");
}

testShortcuts().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
