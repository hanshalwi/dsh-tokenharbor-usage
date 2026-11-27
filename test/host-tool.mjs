/**
 * Offline checks for the host half: no network, no credential file, no DSH
 * process. `fetch` is stubbed so these run anywhere.
 *
 *   node test/host-tool.mjs
 */
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const PAYLOAD = {
  plan_name: 'Agent Pass',
  plan_used_pct: 42.4,
  plan_exhausted: false,
  used_pct: 7,
  exhausted: false,
  models: ['model-a', 'model-b'],
  models_enabled: true,
  on_plan: true,
  reset_at: '2026-12-03T13:09:14.753+00:00',
  period_started_at: '2026-11-26T13:09:14.753+00:00',
  req_used: 123,
  rpm_limit: 1000,
}

const realFetch = globalThis.fetch
const checks = []

function check(label, fn) {
  try {
    fn()
    checks.push(['pass', label])
  } catch (error) {
    checks.push(['fail', `${label}: ${error.message}`])
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Build a Context just wide enough for `apply`, with a counted fetch. */
function harness({ credential = { value: 'thk_test', source: 'test' }, respond = () => jsonResponse(PAYLOAD) } = {}) {
  const state = { calls: 0, requests: [], route: undefined, tool: undefined }
  globalThis.fetch = async (url, init) => {
    state.calls += 1
    state.requests.push({ url, headers: init?.headers })
    return respond(url, init)
  }
  apply({
    credentials: { resolve: async (ref) => { state.ref = ref; return credential } },
    webServer: { register: (route) => { state.route = route; return () => {} } },
    tools: { register: (definition) => { state.tool = definition; return () => {} } },
    effect: (factory) => { factory(); return () => {} },
  })
  return state
}

function fakeRequest({ method = 'GET', url = '/tokenharbor-usage/usage', headers = {} } = {}) {
  return { method, url, headers }
}

function fakeResponse() {
  const out = { status: 0, headers: {}, body: '' }
  return {
    out,
    writeHead(status, headers = {}) { out.status = status; out.headers = headers },
    end(body) { out.body = body ?? '' },
  }
}

async function callRoute(route, req) {
  const res = fakeResponse()
  await route.handler(req, res)
  return { ...res.out, json: res.out.body === '' ? undefined : JSON.parse(res.out.body) }
}

function fakeExec() {
  return { signal: { throwIfAborted() {} } }
}

// --- the tool definition itself -------------------------------------------
{
  const state = harness()
  const def = state.tool
  check('tool is named tokenharbor_usage', () => assert.equal(def.name, 'tokenharbor_usage'))
  check('tool exposes only an optional refresh switch', () => {
    assert.deepEqual(Object.keys(def.parameters), ['refresh'])
    assert.equal(def.parameters.refresh.type, 'boolean')
  })
  check('output schema uses an object-level required array', () => {
    assert.ok(Array.isArray(def.output.schema.required))
    assert.deepEqual([...def.output.schema.required].sort(), Object.keys(def.output.schema.properties).sort())
  })
  check('output schema declares no per-property required flag', () => {
    for (const node of Object.values(def.output.schema.properties)) assert.ok(!('required' in node))
  })
  check('output schema closes the object', () => assert.equal(def.output.schema.additionalProperties, false))
}

// --- one read, then the cache --------------------------------------------
{
  const state = harness()
  const value = await state.tool.execute({}, fakeExec())
  check('read maps the endpoint payload', () => {
    assert.equal(value.planName, 'Agent Pass')
    assert.equal(value.planUsedPercent, 42.4)
    assert.equal(value.freeUsedPercent, 7)
    assert.deepEqual(value.freeModels, ['model-a', 'model-b'])
    assert.equal(value.requests, 123)
    assert.equal(value.resetAt, '2026-12-03T13:09:14.753+00:00')
  })
  check('read sends the bearer key to the allowance endpoint', () => {
    const sent = state.requests[0]
    assert.equal(sent.url, 'https://tokenharbor.ai/api/cli/free-tier')
    assert.equal(sent.headers.authorization, 'Bearer thk_test')
    assert.equal(state.ref, 'TOKENHARBOR_API_KEY')
  })
  check('render projection is plain text lines', () => {
    const blocks = state.tool.output.render({}, value)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'text')
    assert.match(blocks[0].text, /Agent Pass: 42% of the weekly allowance used/)
    assert.match(blocks[0].text, /Requests this window: 123, rate ceiling 1000/)
  })
  await state.tool.execute({}, fakeExec())
  check('a second read reuses the snapshot', () => assert.equal(state.calls, 1))
  await state.tool.execute({ refresh: true }, fakeExec())
  check('refresh bypasses the snapshot', () => assert.equal(state.calls, 2))
}

// --- failure paths -------------------------------------------------------
{
  const state = harness()
  const route = state.route
  check('route path is the one the chip fetches', () => {
    assert.equal(route.path, '/tokenharbor-usage/usage')
    assert.equal(route.kind, 'exact')
  })
  const ok = await callRoute(route, fakeRequest())
  check('GET answers 200 with usage', () => {
    assert.equal(ok.status, 200)
    assert.equal(ok.json.ok, true)
    assert.equal(ok.json.usage.planName, 'Agent Pass')
  })
  const cached = await callRoute(route, fakeRequest())
  check('route shares the tool snapshot', () => assert.equal(state.calls, 1))
  const refreshed = await callRoute(route, fakeRequest({ url: '/tokenharbor-usage/usage?refresh=1' }))
  check('route honours ?refresh=1', () => assert.equal(state.calls, 2))
  assert.equal(refreshed.status, 200)
  const head = await callRoute(route, fakeRequest({ method: 'HEAD' }))
  check('HEAD is allowed', () => assert.equal(head.status, 200))
  const post = await callRoute(route, fakeRequest({ method: 'POST' }))
  check('writes are refused with an Allow header', () => {
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET, HEAD')
    assert.equal(post.json.ok, false)
  })
  const crossSite = await callRoute(route, fakeRequest({ headers: { 'sec-fetch-site': 'cross-site' } }))
  check('another origin is refused', () => {
    assert.equal(crossSite.status, 403)
    assert.equal(crossSite.json.error.code, 'forbidden')
  })
  const sameOrigin = await callRoute(route, fakeRequest({ headers: { 'sec-fetch-site': 'same-origin' } }))
  check('the app itself is allowed', () => assert.equal(sameOrigin.status, 200))
  const noStore = await callRoute(route, fakeRequest())
  check('route answers with no-store and a sniff guard', () => {
    assert.equal(noStore.headers['cache-control'], 'no-store')
    assert.equal(noStore.headers['x-content-type-options'], 'nosniff')
    assert.equal(noStore.headers['content-type'], 'application/json; charset=utf-8')
  })
}

{
  // An empty stored value is "absent" to the credential service, so this is
  // how an unset key actually arrives.
  const state = harness({ credential: { value: '', source: 'test' } })
  await assert.rejects(() => state.tool.execute({}, fakeExec()), /TOKENHARBOR_API_KEY credential is not set/)
  check('missing credential is reported by the tool', () => assert.equal(state.calls, 0))
  const res = await callRoute(state.route, fakeRequest())
  check('missing credential answers 502 with the same text', () => {
    assert.equal(res.status, 502)
    assert.match(res.json.error.message, /credential is not set/)
  })
}

{
  const state = harness({ respond: () => jsonResponse({ error: 'nope' }, 401) })
  await assert.rejects(() => state.tool.execute({}, fakeExec()), /HTTP 401\. Check the TOKENHARBOR_API_KEY credential\./)
  check('an auth failure names the credential', () => assert.equal(state.calls, 1))
}

{
  const state = harness({ respond: () => new Response('<html>nope</html>', { status: 200 }) })
  await assert.rejects(() => state.tool.execute({}, fakeExec()), /not JSON/)
  check('a non-JSON body is reported', () => assert.equal(state.calls, 1))
}

{
  const empty = harness({ respond: () => jsonResponse({}) })
  const value = await empty.tool.execute({}, fakeExec())
  check('an empty payload degrades to zeroes, not a crash', () => {
    assert.equal(value.planName, '')
    assert.equal(value.planUsedPercent, 0)
    assert.deepEqual(value.freeModels, [])
    assert.equal(value.resetAt, '')
  })

  const odd = harness({ respond: () => jsonResponse({ plan_used_pct: 140, used_pct: -3, models: ['a', 7, null] }) })
  const clamped = await odd.tool.execute({}, fakeExec())
  check('percentages clamp and non-string models drop', () => {
    assert.equal(clamped.planUsedPercent, 100)
    assert.equal(clamped.freeUsedPercent, 0)
    assert.deepEqual(clamped.freeModels, ['a'])
  })
}

globalThis.fetch = realFetch

const failed = checks.filter(([status]) => status === 'fail')
for (const [status, label] of checks) console.log(`${status === 'pass' ? 'ok  ' : 'FAIL'} ${label}`)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exitCode = 1