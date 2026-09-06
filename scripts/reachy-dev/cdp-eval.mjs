const port = 9356; const expr = process.argv[2] || "typeof window.__duckRuntime";
const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = t.find((x) => x.type === "page" && /renderer-dist\/index\.html/.test(x.url));
if (!page) { console.log("pages:", t.map((x) => x.type + " " + x.url).join("\n")); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
const res = await new Promise((res) => { ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m); }); ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
console.log(JSON.stringify(res.result, null, 1).slice(0, 1500)); ws.close();
