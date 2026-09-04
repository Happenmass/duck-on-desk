#!/usr/bin/env bash
# Posts a state sequence to the running app and asserts each is accepted.
set -euo pipefail
PORT=$(node -e 'const fs=require("fs"),os=require("os"),p=require("path");try{process.stdout.write(String(JSON.parse(fs.readFileSync(p.join(os.homedir(),".duck-on-desk","runtime.json"),"utf8")).port))}catch{process.stdout.write("24333")}')
for state in thinking working juggling notification attention error sleeping idle; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/state" -H 'content-type: application/json' \
    -d "{\"state\":\"${state}\",\"session_id\":\"smoke\",\"agent_id\":\"claude-code\",\"event\":\"Smoke\"}")
  echo "${state} -> ${code}"
  [ "$code" = "200" ] || { echo "FAIL: ${state} returned ${code}"; exit 1; }
  sleep 1.5
done
echo "smoke ok"
