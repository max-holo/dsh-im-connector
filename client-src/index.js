// im-connector client plugin (browser half).
//
// Two surfaces:
// 1. `tool.call.toolview` for `mcp__im__login` — renders the login QR inline in
//    the chat row through the tool-owned `tool.call.images` gallery.
// 2. `settings.section` — an "IM 连接器" settings page that shows each provider's
//    CLI version / login state and drives the login flow through the host's
//    /api/im-connector/* routes (QR shown in the page, status polls).
//
// Source of the built artifact `lib/client.js`; see scripts/build-client.mjs.
import React from 'react'

export const name = 'im-connector-client'
export const inject = ['slots']

const CARD = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))',
  background: 'var(--dsw-alias-bg-l1, transparent)',
}
const ROW = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '8px 10px',
  borderRadius: '10px',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))',
  background: 'var(--dsw-alias-bg-l1, transparent)',
  maxWidth: '100%',
  overflow: 'hidden',
}
const TITLE = { fontSize: '13px', fontWeight: 600, lineHeight: 1.4 }
const LABEL = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8a92)' }
const MUTED = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary, #8a8a92)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}
const HEADING = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
const PILL_OK = {
  fontSize: '11px',
  padding: '1px 8px',
  borderRadius: '999px',
  background: 'var(--dsw-alias-state-success-primary, #2ecc71)',
  color: '#fff',
}
const PILL_WARN = {
  fontSize: '11px',
  padding: '1px 8px',
  borderRadius: '999px',
  background: 'var(--dsw-alias-state-warn-primary, #f5a623)',
  color: '#fff',
}
const BUTTON = {
  fontSize: '12px',
  lineHeight: 1.4,
  padding: '4px 12px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
  background: 'var(--dsw-alias-bg-l2, rgba(128,128,128,0.08))',
  color: 'var(--dsw-alias-label-primary, inherit)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function contentBlocks(block) {
  return block !== null && typeof block === 'object' && Array.isArray(block.content) ? block.content : []
}

function imageSources(block) {
  const images = []
  for (const part of contentBlocks(block)) {
    if (part === null || typeof part !== 'object') continue
    if (part.type !== 'image') continue
    if (part.attachment === null || typeof part.attachment !== 'object') continue
    images.push({ attachment: part.attachment })
  }
  return images
}

function textOf(block) {
  const parts = []
  for (const part of contentBlocks(block)) {
    if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.join('\n')
}

function hintOf(text) {
  try {
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.hint === 'string') return parsed.hint
  } catch {
    /* not JSON: fall through to plain text */
  }
  return ''
}

// ---------------------------------------------------------------------------
// 1. Inline login row
// ---------------------------------------------------------------------------

function LoginRow(props) {
  const phase = props.phase
  const children = [React.createElement('div', { style: TITLE, key: 'title' }, '授权登录')]
  if (phase !== 'result') {
    children.push(
      React.createElement('div', { style: MUTED, key: 'running' },
        phase === 'preparing' ? '正在准备登录…' : '正在发起登录…'),
    )
    return React.createElement('div', { style: ROW }, children)
  }

  const block = props.block
  const images = imageSources(block)
  const text = textOf(block)
  const hint = hintOf(text)

  if (images.length > 0) {
    const gallery = props.renderSlot !== undefined && props.loadImage !== undefined
      ? props.renderSlot('tool.call.images', { images, loadImage: props.loadImage, align: 'start' })
      : React.createElement('div', { style: MUTED, key: 'qr-missing' }, '二维码已生成，可在工具结果中查看 qrPath')
    children.push(React.createElement('div', { key: 'images' }, gallery))
  }
  if (hint !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'hint' }, hint))
  } else if (text !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'text' }, text.slice(0, 800)))
  }
  return React.createElement('div', { style: ROW }, children)
}

// ---------------------------------------------------------------------------
// 2. Settings page
// ---------------------------------------------------------------------------

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  const data = await response.json()
  if (data === null || typeof data !== 'object' || data.ok !== true) {
    throw new Error((data && typeof data.error === 'string' && data.error) || `request failed (${response.status})`)
  }
  return data
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (data === null || typeof data !== 'object' || data.ok !== true) {
    throw new Error((data && typeof data.error === 'string' && data.error) || `request failed (${response.status})`)
  }
  return data
}

function authorizedOf(info) {
  if (info.authError !== undefined) return false
  const auth = info.auth
  if (typeof auth === 'string') return /authoriz|authenticat/i.test(auth) && !/unauthoriz|unauthenticat/i.test(auth)
  if (auth !== null && typeof auth === 'object') {
    if (auth.authenticated === true) return true
    if (typeof auth.authenticated === 'boolean') return auth.authenticated
  }
  return false
}

function statusOf(info) {
  if (info.authError !== undefined) return { text: '未登录', ok: false }
  if (authorizedOf(info)) return { text: '已登录', ok: true }
  return { text: '未登录', ok: false }
}

function shortVersion(info) {
  const version = typeof info.version === 'string' ? info.version : ''
  if (version === '') return '未知版本'
  return version.length > 60 ? version.slice(0, 60) + '…' : version
}

function shortPath(value) {
  if (typeof value !== 'string' || value === '') return ''
  const normalized = value.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  return index >= 0 ? '…' + normalized.slice(index) : normalized
}

function ProviderCard(props) {
  const { info, session } = props
  const status = statusOf(info)
  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: TITLE }, info.displayName || info.id),
      React.createElement('span', { style: status.ok ? PILL_OK : PILL_WARN }, status.text),
      info.bundled ? React.createElement('span', { style: LABEL }, '内置二进制') : null,
    ),
    React.createElement('div', { style: LABEL, key: 'version' }, shortVersion(info)),
  ]
  const path = shortPath(info.resolved)
  if (path !== '') children.push(React.createElement('div', { style: LABEL, key: 'path' }, path))
  if (info.authError !== undefined) {
    children.push(React.createElement('div', { style: MUTED, key: 'auth-error' }, info.authError))
  }

  const actions = [
    React.createElement('button', {
      key: 'login',
      type: 'button',
      style: BUTTON,
      disabled: Boolean(session && session.busy),
      onClick: () => props.onLogin(info.id),
    }, session && session.busy ? '登录中…' : status.ok ? '重新登录' : '登录'),
    React.createElement('button', {
      key: 'refresh',
      type: 'button',
      style: BUTTON,
      onClick: () => props.onRefresh(),
    }, '刷新'),
  ]
  children.push(React.createElement('div', { style: { display: 'flex', gap: '8px' }, key: 'actions' }, actions))

  if (session) {
    if (session.error) children.push(React.createElement('div', { style: MUTED, key: 'error' }, session.error))
    if (session.qrDataUrl) {
      children.push(React.createElement('img', {
        key: 'qr',
        src: session.qrDataUrl,
        alt: '登录二维码',
        style: { width: '180px', height: '180px', borderRadius: '8px', background: '#fff', padding: '6px' },
      }))
    }
    if (session.hint) children.push(React.createElement('div', { style: MUTED, key: 'hint' }, session.hint))
    if (session.outputTail) {
      children.push(React.createElement('div', { style: MUTED, key: 'tail' }, session.outputTail))
    }
  }

  return React.createElement('div', { style: CARD }, children)
}

function SettingsPage() {
  const [state, setState] = React.useState({ loading: true, error: '', providers: [] })
  const [sessions, setSessions] = React.useState({})

  const refresh = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const data = await getJson('/api/im-connector/info')
      setState({ loading: false, error: '', providers: Array.isArray(data.providers) ? data.providers : [] })
    } catch (error) {
      setState({ loading: false, error: String((error && error.message) || error), providers: [] })
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  React.useEffect(() => {
    const running = Object.keys(sessions).filter((key) => sessions[key] && sessions[key].running)
    if (running.length === 0) return undefined
    const timer = setInterval(async () => {
      for (const provider of running) {
        try {
          const data = await getJson(`/api/im-connector/login-status?provider=${encodeURIComponent(provider)}`)
          if (data.authorized || !data.running) {
            setSessions((current) => ({ ...current, [provider]: undefined }))
            refresh()
          }
        } catch {
          /* keep polling; a transient failure must not stop the wait */
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [sessions, refresh])

  const startLogin = React.useCallback(async (provider) => {
    setSessions((current) => ({ ...current, [provider]: { busy: true, running: true } }))
    try {
      const data = await postJson('/api/im-connector/login', { provider })
      setSessions((current) => ({
        ...current,
        [provider]: {
          busy: false,
          running: Boolean(data.running),
          qrDataUrl: data.qrDataUrl,
          hint: data.hint,
          outputTail: data.outputTail,
        },
      }))
    } catch (error) {
      setSessions((current) => ({
        ...current,
        [provider]: { busy: false, running: false, error: String((error && error.message) || error) },
      }))
    }
  }, [])

  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: { fontSize: '15px', fontWeight: 600 } }, 'IM 连接器'),
      state.loading ? React.createElement('span', { style: LABEL }, '检测中…') : null,
    ),
    React.createElement('div', { style: LABEL, key: 'desc' },
      '钉钉（dws）与企业微信（wecom-cli）的 Agent 侧连接：查看 CLI 版本与登录状态，扫码登录后会立即生效。'),
    state.error
      ? React.createElement('div', { style: { ...MUTED, color: 'var(--dsw-alias-state-error-primary, #e5484d)' }, key: 'error' }, state.error)
      : null,
    state.providers.length === 0 && !state.loading
      ? React.createElement('div', { style: MUTED, key: 'empty' }, '没有已注册的平台。')
      : null,
  ]
  for (const info of state.providers) {
    children.push(React.createElement(ProviderCard, {
      key: info.id,
      info,
      session: sessions[info.id],
      onLogin: startLogin,
      onRefresh: refresh,
    }))
  }
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, children)
}

export function apply(ctx) {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'mcp__im__login',
    children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
  }, LoginRow))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'im-connector-settings',
    order: 22,
    label: 'IM 连接器',
  }, SettingsPage))
}
