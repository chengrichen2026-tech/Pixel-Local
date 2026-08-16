#!/usr/bin/env node

const response = await fetch("http://127.0.0.1:43127/health");
if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
