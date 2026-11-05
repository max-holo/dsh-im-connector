// Build the browser bundle for the im-connector client plugin in the lazy-CJS
// factory format the harness client module system serves:
//   window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => { ... } });
//
// client-src/index.js is a single-file plugin whose only import is the React
// baseline external, so the build is a deterministic transform (import/exports
// → CommonJS) plus the factory wrapper — no bundler spawn required.
// Run: node scripts/build-client.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : 'im-connector'
const source = readFileSync(join(root, 'client-src', 'index.js'), 'utf8')

let body = source
  .replace("import React from 'react'", "const React = require('react')")
  .replace(/export const name = '([^']+)'/, (_m, value) => `exports.name = ${JSON.stringify(value)}`)
  .replace(/export const inject = (\[[^\]]*\])/, (_m, value) => `exports.inject = ${value}`)
  .replace(/export function apply\(ctx\) \{/, 'exports.apply = function apply(ctx) {')

for (const needle of ['\nimport ', '\nexport ']) {
  if (body.includes(needle)) throw new Error(`untransformed ESM syntax left in client source: ${needle.trim()}`)
}

const banner = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(id) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
].join('\n')
const footer = '\t\treturn module.exports;\n\t}\n});'

const out = `${banner}\n${body}\n${footer}\n`
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), out, 'utf8')
console.log(`built lib/client.js (${out.length} bytes, id=${id})`)
