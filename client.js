/**
 * Browser half of TokenHarbor usage: the chip at the sidebar foot and the
 * allowance popover.
 *
 * The chip never talks to TokenHarbor. It fetches the host half's own route,
 * which does the request with the stored API key, and the host reuses a
 * snapshot for up to a minute, so opening and closing the popover costs
 * nothing.
 */

window.__ModuleLoader__.load({
  id: 'dsh-tokenharbor-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React

    const NS = 'tokenharbor-usage'
    const ROUTE_PATH = '/tokenharbor-usage/usage'
    const POLL_MS = 60_000
    const TICK_MS = 30_000
    const STYLE_ID = 'dsh-tokenharbor-usage-styles'

    const DICTS = {
      en: {
        label: 'TokenHarbor usage',
        chip: 'TokenHarbor',
        pass: 'Pass',
        free: 'Free',
        loading: 'Reading allowance…',
        failed: 'Allowance unavailable',
        retry: 'Retry',
        refresh: 'Refresh',
        refreshing: 'Reading…',
        resetsIn: 'Resets in',
        resetsNow: 'Resetting now',
        usedUp: 'Used up',
        freeModels: 'Free models',
        modelsOff: 'Free models are off for this account',
        window: 'requests this window',
        updated: 'Updated',
      },
      zh: {
        label: 'TokenHarbor 用量',
        chip: 'TokenHarbor',
        pass: '付费套餐',
        free: '免费模型',
        loading: '正在读取额度…',
        failed: '额度不可用',
        retry: '重试',
        refresh: '刷新',
        refreshing: '读取中…',
        resetsIn: '重置倒计时',
        resetsNow: '即将重置',
        usedUp: '已用完',
        freeModels: '免费模型',
        modelsOff: '此账号已停用免费模型',
        window: '本周请求数',
        updated: '更新于',
      },
    }

    const CSS = `
.thu-root { position: relative; flex: none; display: flex; align-items: center; width: 100%; }
.thu-chip { display: flex; align-items: center; gap: 8px; width: 100%; height: 42px; padding: 0 10px 0 8px; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 1; text-align: left; cursor: pointer; overflow: hidden; }
.thu-chip:not(.thu-chip--wide) { justify-content: center; gap: 0; padding: 0; }
@media (hover: hover) { .thu-chip:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.thu-chip[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.thu-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.thu-chip__glyph { flex: none; display: block; }
.thu-glyph__track { fill: var(--dsw-alias-state-idle-primary); fill-opacity: 0.28; }
.thu-chip__text { flex: 1 1 auto; display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.thu-chip__name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.thu-chip__nums { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.thu-popover { position: fixed; z-index: 40; width: 264px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 12px 32px rgb(0 0 0 / 22%); font-family: inherit; font-size: 12px; line-height: 1.45; }
.thu-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.thu-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; font-weight: 600; }
.thu-button { flex: none; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 11px; cursor: pointer; }
@media (hover: hover) { .thu-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
.thu-button:disabled { opacity: 0.5; cursor: default; }
.thu-body { display: flex; flex-direction: column; gap: 10px; }
.thu-row__head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.thu-row__label { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }
.thu-row__pct { flex: none; margin-left: auto; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.thu-bar { height: 6px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.thu-bar__fill { height: 100%; border-radius: 3px; }
.thu-row__note { margin-top: 4px; color: var(--dsw-alias-label-tertiary); }
.thu-section__title { margin-bottom: 6px; color: var(--dsw-alias-label-secondary); }
.thu-models { display: flex; flex-wrap: wrap; gap: 4px; }
.thu-model { padding: 2px 6px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.thu-note { display: flex; align-items: center; gap: 8px; }
.thu-note--error { color: var(--dsw-alias-state-error-primary); }
.thu-note--warn { color: var(--dsw-alias-state-warn-primary); }
.thu-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
`

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.append(tag)
      return () => { tag.remove() }
    }

    function percentOf(value) {
      const number = Number(value)
      return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0
    }

    function percentText(value) {
      return `${Math.round(percentOf(value))}%`
    }

    function toneFor(value, quiet) {
      const percent = percentOf(value)
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)'
      return quiet
    }

    function formatRemaining(ms) {
      const minutes = Math.max(0, Math.floor(ms / 60_000))
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes % 60}m`
      return `${minutes}m`
    }

    function formatClock(iso) {
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return ''
      return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }

    /** Read the host half's route; it owns the key and the cache. */
    function useUsage() {
      const [state, setState] = useState({ status: 'loading' })
      const load = useCallback(async (refresh) => {
        setState((current) => current.usage === undefined
          ? { status: 'loading' }
          : { ...current, busy: true })
        try {
          const response = await fetch(refresh === true ? `${ROUTE_PATH}?refresh=1` : ROUTE_PATH, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const payload = await response.json()
          if (payload?.ok !== true) {
            throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          }
          setState({ status: 'ready', usage: payload.usage, busy: false })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setState((current) => current.usage === undefined
            ? { status: 'error', error: message, busy: false }
            : { ...current, status: 'stale', error: message, busy: false })
        }
      }, [])
      useEffect(() => {
        load(false)
        const id = window.setInterval(() => { load(false) }, POLL_MS)
        return () => { window.clearInterval(id) }
      }, [load])
      return [state, load]
    }

    /** Two bars: paid Pass on top, free-model pool below. */
    function GaugeGlyph({ passPct, freePct, failed }) {
      const pass = percentOf(passPct)
      const free = percentOf(freePct)
      const passTone = failed
        ? 'var(--dsw-alias-state-error-primary)'
        : toneFor(pass, 'var(--dsw-alias-brand-primary)')
      return h('svg', {
        className: 'thu-chip__glyph',
        width: 18,
        height: 18,
        viewBox: '0 0 18 18',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('rect', { key: 'track-pass', x: 1, y: 3.5, width: 16, height: 5, rx: 2.5, className: 'thu-glyph__track' }),
        h('rect', { key: 'fill-pass', x: 1, y: 3.5, width: 16 * pass / 100, height: 5, rx: 2.5, fill: passTone }),
        h('rect', { key: 'track-free', x: 1, y: 10.5, width: 16, height: 5, rx: 2.5, className: 'thu-glyph__track' }),
        h('rect', { key: 'fill-free', x: 1, y: 10.5, width: 16 * free / 100, height: 5, rx: 2.5, fill: 'var(--dsw-alias-state-success-primary)' }),
      ])
    }

    function UsageRow({ label, percent, tone, note }) {
      return h('div', { className: 'thu-row' }, [
        h('div', { key: 'head', className: 'thu-row__head' }, [
          h('span', { key: 'label', className: 'thu-row__label' }, label),
          h('span', { key: 'pct', className: 'thu-row__pct' }, percentText(percent)),
        ]),
        h('div', { key: 'bar', className: 'thu-bar' },
          h('div', { className: 'thu-bar__fill', style: { width: `${percentOf(percent)}%`, background: tone } })),
        note === undefined ? null : h('div', { key: 'note', className: 'thu-row__note' }, note),
      ])
    }

    function TokenHarborChip(props) {
      const { wide, t } = props
      const [state, load] = useUsage()
      const [open, setOpen] = useState(false)
      const [anchor, setAnchor] = useState()
      const [now, setNow] = useState(() => Date.now())
      const rootRef = useRef(null)

      // The panel is position: fixed (the sidebar clips overflow), so it hugs
      // the trigger through a measured offset instead of document flow.
      useLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const rect = rootRef.current?.getBoundingClientRect()
          if (rect !== undefined && rect !== null) {
            setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
          }
        }
        place()
        window.addEventListener('resize', place)
        return () => { window.removeEventListener('resize', place) }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const root = rootRef.current
          if (root === null || !root.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
        return () => { window.clearInterval(id) }
      }, [open])

      const usage = state.usage
      const remaining = usage === undefined ? Number.NaN : Date.parse(usage.resetAt) - now
      const resetNote = () => {
        if (Number.isNaN(remaining)) return undefined
        return remaining <= 0 ? t('resetsNow') : `${t('resetsIn')} ${formatRemaining(remaining)}`
      }

      let body
      if (usage === undefined) {
        body = state.status === 'error'
          ? h('div', { className: 'thu-note thu-note--error' }, [
              h('span', { key: 'message' }, state.error ?? t('failed')),
              h('button', { key: 'retry', type: 'button', className: 'thu-button', onClick: () => load(true) }, t('retry')),
            ])
          : h('div', { className: 'thu-note' }, t('loading'))
      } else {
        const models = usage.freeModelsEnabled && usage.freeModels.length > 0
          ? h('div', { key: 'models', className: 'thu-section' }, [
              h('div', { key: 'title', className: 'thu-section__title' }, `${t('freeModels')} · ${usage.freeModels.length}`),
              h('div', { key: 'list', className: 'thu-models' },
                usage.freeModels.map((model) => h('span', { key: model, className: 'thu-model' }, model))),
            ])
          : null
        body = h('div', { className: 'thu-body' }, [
          usage.freeModelsEnabled ? null : h('div', { key: 'off', className: 'thu-note' }, t('modelsOff')),
          h(UsageRow, {
            key: 'pass',
            label: usage.planName === '' ? t('pass') : `${t('pass')} · ${usage.planName}`,
            percent: usage.planUsedPercent,
            tone: toneFor(usage.planUsedPercent, 'var(--dsw-alias-brand-primary)'),
            note: usage.planExhausted ? t('usedUp') : resetNote(),
          }),
          h(UsageRow, {
            key: 'free',
            label: t('free'),
            percent: usage.freeUsedPercent,
            tone: toneFor(usage.freeUsedPercent, 'var(--dsw-alias-state-success-primary)'),
            note: usage.freeExhausted ? t('usedUp') : (usage.freeModelsEnabled ? undefined : t('modelsOff')),
          }),
          models,
          state.status === 'stale'
            ? h('div', { key: 'stale', className: 'thu-note thu-note--warn' }, state.error ?? t('failed'))
            : null,
        ])
      }

      // A failed read explains itself in the body, so the foot only carries the
      // snapshot stamp once there is one.
      const foot = usage === undefined
        ? (state.status === 'error' ? null : h('div', { key: 'foot', className: 'thu-foot' }, t('loading')))
        : h('div', { key: 'foot', className: 'thu-foot' },
            `${t('updated')} ${formatClock(usage.readAt)} · ${usage.requests} ${t('window')}`)

      const popover = open
        ? h('div', {
            className: 'thu-popover',
            role: 'dialog',
            'aria-label': t('label'),
            style: anchor === undefined ? { visibility: 'hidden' } : { left: anchor.left, bottom: anchor.bottom },
          }, [
            h('div', { key: 'head', className: 'thu-head' }, [
              h('span', { key: 'title', className: 'thu-title' }, t('label')),
              h('button', {
                key: 'refresh',
                type: 'button',
                className: 'thu-button',
                disabled: state.busy === true,
                onClick: () => load(true),
              }, state.busy === true ? t('refreshing') : t('refresh')),
            ]),
            h('div', { key: 'body', className: 'thu-content' }, body),
            foot,
          ])
        : null

      return h('div', { className: 'thu-root', ref: rootRef }, [
        h('button', {
          key: 'chip',
          type: 'button',
          className: wide === true ? 'thu-chip thu-chip--wide' : 'thu-chip',
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-label': t('label'),
          title: usage === undefined
            ? t('label')
            : `${t('pass')} ${percentText(usage.planUsedPercent)} · ${t('free')} ${percentText(usage.freeUsedPercent)}`,
          onClick: () => setOpen((value) => !value),
        }, [
          h(GaugeGlyph, {
            key: 'glyph',
            passPct: usage?.planUsedPercent,
            freePct: usage?.freeUsedPercent,
            failed: state.status === 'error',
          }),
          wide === true
            ? h('span', { key: 'text', className: 'thu-chip__text' }, [
                h('span', { key: 'name', className: 'thu-chip__name' }, t('chip')),
                h('span', { key: 'nums', className: 'thu-chip__nums' },
                  usage === undefined ? '—' : `${percentText(usage.planUsedPercent)} · ${percentText(usage.freeUsedPercent)}`),
              ])
            : null,
        ]),
        popover,
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        let translate
        if (locale !== undefined && locale !== null) {
          ctx.effect(() => {
            try {
              return locale.register(NS, DICTS)
            } catch {
              return () => {}
            }
          }, 'dsh-tokenharbor-usage: dictionaries')
          try {
            const bound = locale.bind(NS)
            if (typeof bound === 'function') translate = bound
          } catch {
            /* Keep the bundled English strings. */
          }
        }
        const t = (key) => {
          if (translate !== undefined) {
            const value = translate(key)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          }
          return DICTS.en[key] ?? key
        }

        ctx.effect(installStyles, 'dsh-tokenharbor-usage: styles')

        const Chip = (props) => h(TokenHarborChip, { ...props, t })
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'tokenharbor-usage',
          order: 5,
          label: () => t('label'),
        }, Chip))
      },
    }
  },
})
