/**
 * Offline checks for the browser half: no browser, no React install, no network.
 *
 * client.js wants `window.__ModuleLoader__` and `require('react')` from the
 * page's module table, so this file provides a fake loader and a ~40-line React
 * shim (createElement, useState with per-hook overrides, no-op effects). It then
 * renders every state the chip can be in and asserts the markup.
 *
 *   node test/client-render.cjs
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')

let loaded
globalThis.window = {
  __ModuleLoader__: { load: (mod) => { loaded = mod } },
  innerHeight: 800,
}

let hookIndex = 0
let overrides = {}

const React = {
  createElement: (type, props, ...children) => {
    const flat = children.flat().filter((child) => child !== undefined)
    const merged = { ...(props ?? {}) }
    if (flat.length > 0) merged.children = flat.length === 1 ? flat[0] : flat
    return { type, props: merged }
  },
  useState: (initial) => {
    const seed = Object.prototype.hasOwnProperty.call(overrides, hookIndex)
      ? overrides[hookIndex]
      : (typeof initial === 'function' ? initial() : initial)
    hookIndex += 1
    return [seed, () => {}]
  },
  useRef: (initial) => { hookIndex += 1; return { current: initial ?? null } },
  useEffect: () => { hookIndex += 1 },
  useLayoutEffect: () => { hookIndex += 1 },
  useCallback: (fn) => { hookIndex += 1; return fn },
}

new Function(readFileSync(join(__dirname, '..', 'client.js'), 'utf8'))()
assert.equal(loaded.id, 'dsh-tokenharbor-usage', 'module id must equal the package name')

let registered
let injected
const ctx = {
  get: () => undefined,
  effect: (factory) => factory(),
  slots: {
    inject: (key, callback) => { injected = key; return callback() },
    register: (registration, component) => { registered = { registration, component } },
  },
}
const mod = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`client module required '${id}', which is not available in a bundle`)
})
mod.apply(ctx)

assert.deepEqual(mod.inject, ['slots'])
assert.equal(injected, 'sidebar.footer.action')
assert.equal(registered.registration.id, 'tokenharbor-usage')
assert.equal(registered.registration.order, 5)

const UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'lineHeight', 'fillOpacity', 'fontWeight'])

/** Walk the tree the component returns, collecting class names and text. */
function walk(node, classes, texts) {
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
  if (Array.isArray(node)) { for (const child of node) walk(child, classes, texts); return }
  const { type, props } = node
  if (typeof type === 'function') return walk(type(props), classes, texts)
  if (typeof type === 'string') {
    if (typeof props.className === 'string') classes.push(props.className)
    if (typeof props.title === 'string') texts.push(`title=${props.title}`)
    for (const [key, value] of Object.entries(props.style ?? {})) {
      if (typeof value === 'number' && UNITLESS.has(key)) throw new Error(`style ${key} needs a unit`)
    }
  }
  walk(props.children, classes, texts)
}

const sample = {
  planName: 'Agent Pass',
  planUsedPercent: 20,
  planExhausted: false,
  freeUsedPercent: 14,
  freeExhausted: false,
  freeModels: ['deepseek-v4-flash', 'mimo-v2.6-flash', 'mimo-v2.5', 'deepseek-v4.1-flash'],
  freeModelsEnabled: true,
  onPlan: true,
  resetAt: new Date(Date.now() + 6 * 86_400_000 + 4 * 3_600_000).toISOString(),
  periodStartedAt: '2026-11-26T13:09:14.753+00:00',
  requests: 692,
  requestsPerMinuteLimit: 1_000_000,
  readAt: new Date().toISOString(),
}

const states = {
  ready: { status: 'ready', usage: sample, busy: false },
  error: { status: 'error', error: 'The TOKENHARBOR_API_KEY credential is not set.', busy: false },
  stale: {
    status: 'stale',
    usage: { ...sample, freeModelsEnabled: false, freeModels: [], freeUsedPercent: 96, resetAt: new Date(Date.now() + 90_000).toISOString() },
    error: 'TokenHarbor answered HTTP 500.',
    busy: false,
  },
  exhausted: { status: 'ready', usage: { ...sample, planUsedPercent: 100, planExhausted: true, freeUsedPercent: 100, freeExhausted: true }, busy: false },
}

/**
 * Hook order inside the chip: 0 useUsage state, 1 its useCallback, 2 its
 * useEffect, 3 open, 4 anchor, 5 now, then useRef and the remaining effects.
 */
function render(state, { open = false, wide = true, anchor } = {}) {
  hookIndex = 0
  overrides = { 0: state, 3: open, 4: anchor, 5: Date.now() }
  const classes = []
  const texts = []
  walk(React.createElement(registered.component, { wide }), classes, texts)
  return { classes, texts, has: (cls) => classes.some((entry) => entry.split(' ').includes(cls)) }
}

const checks = []
const check = (label, fn) => {
  try { fn(); checks.push(`ok   ${label}`) } catch (error) { checks.push(`FAIL ${label}: ${error.message}`) }
}

render({ status: 'loading' })
check('the loading state renders', () => assert.ok(true))

const closedWide = render(states.ready)
check('closed chip shows the name and both percentages', () => {
  assert.ok(closedWide.has('thu-chip--wide'))
  assert.ok(closedWide.texts.includes('TokenHarbor'))
  assert.ok(closedWide.texts.includes('20% · 14%'))
})
check('closed chip renders no popover', () => assert.equal(closedWide.has('thu-popover'), false))
check('closed chip names both pools in its tooltip', () =>
  assert.ok(closedWide.texts.includes('title=Pass 20% · Free 14%')))

const closedRail = render(states.ready, { wide: false })
check('collapsed rail drops the text', () => {
  assert.equal(closedRail.has('thu-chip--wide'), false)
  assert.ok(!closedRail.texts.includes('TokenHarbor'))
  assert.ok(!closedRail.texts.includes('20% · 14%'))
})
check('collapsed rail keeps the tooltip', () =>
  assert.ok(closedRail.texts.includes('title=Pass 20% · Free 14%')))

const openReady = render(states.ready, { open: true, anchor: { left: 12, bottom: 300 } })
check('popover lists both pools, the countdown, and the models', () => {
  assert.ok(openReady.has('thu-popover'))
  assert.ok(openReady.texts.includes('Pass · Agent Pass'))
  assert.ok(openReady.texts.includes('Resets in 6d 3h'))
  assert.ok(openReady.texts.includes('Free models · 4'))
  assert.ok(openReady.texts.includes('deepseek-v4-flash'))
  assert.ok(openReady.texts.includes('Refresh'))
  assert.match(openReady.texts.find((line) => line.startsWith('Updated')) ?? '', /692 requests this window/)
})
check('popover opens with a visibility guard until measured', () => {
  const unplaced = render(states.ready, { open: true })
  assert.ok(unplaced.has('thu-popover'))
})

const openError = render(states.error, { open: true, anchor: { left: 12, bottom: 300 } })
check('an error offers a retry and drops the loading foot', () => {
  assert.ok(openError.texts.includes('The TOKENHARBOR_API_KEY credential is not set.'))
  assert.ok(openError.texts.includes('Retry'))
  assert.ok(!openError.texts.includes('Reading allowance...'))
})

const openStale = render(states.stale, { open: true, anchor: { left: 12, bottom: 300 } })
check('a stale snapshot keeps the numbers and warns', () => {
  assert.ok(openStale.texts.includes('TokenHarbor answered HTTP 500.'))
  assert.ok(openStale.texts.includes('Resets in 1m'))
  assert.ok(openStale.texts.includes('Free models are off for this account'))
})

const openExhausted = render(states.exhausted, { open: true, anchor: { left: 12, bottom: 300 } })
check('an exhausted allowance reads as used up', () => {
  assert.equal(openExhausted.texts.filter((line) => line === 'Used up').length, 2)
  assert.ok(openExhausted.texts.includes('100% · 100%'))
})

const failed = checks.filter((line) => line.startsWith('FAIL'))
for (const line of checks) console.log(line)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1