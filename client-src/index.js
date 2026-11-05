// im-connector client plugin (browser half).
//
// Surfaces:
// 1. `tool.call.toolview` for `mcp__im__login` — inline QR + quick actions.
// 2. `settings.section` — "IM 连接器" page: provider status, QR login, user
//    config (CLI bin overrides), resource browser, diagnostics.
// 3. `conversation.session.header.utilities` — a compact IM status chip.
//
// All data comes from the host half's /api/im-connector/* routes. Source of the
// built artifact `lib/client.js`; see scripts/build-client.mjs.
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
const SECTION_TITLE = { fontSize: '14px', fontWeight: 600, lineHeight: 1.5 }
const LABEL = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8a92)' }
const MUTED = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary, #8a8a92)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}
const HEADING = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
const PILL = base => ({ fontSize: '11px', padding: '1px 8px', borderRadius: '999px', color: '#fff', ...base })
const PILL_OK = PILL({ background: 'var(--dsw-alias-state-success-primary, #2ecc71)' })
const PILL_WARN = PILL({ background: 'var(--dsw-alias-state-warn-primary, #f5a623)' })
const PILL_INFO = PILL({ background: 'var(--dsw-alias-state-info-primary, #4a9eff)' })
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
const BUTTON_PRIMARY = { ...BUTTON, background: 'var(--dsw-alias-brand-primary, #0089ff)', borderColor: 'transparent', color: '#fff' }
const INPUT = {
  fontSize: '12px',
  padding: '4px 8px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
  background: 'var(--dsw-alias-bg-l1, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
}

// ---------------------------------------------------------------------------
// HTTP + formatting helpers
// ---------------------------------------------------------------------------

async function requestJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (data === null || typeof data !== 'object' || data.ok !== true) {
    const reason = data && typeof data.error === 'string' ? data.error : `request failed (${response.status})`
    throw new Error(reason)
  }
  return data
}

const getJson = url => requestJson(url)
const postJson = (url, body) => requestJson(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const putJson = (url, body) => requestJson(url, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function authorizedOf(info) {
  if (!info || info.authError !== undefined) return false
  const auth = info.auth
  if (typeof auth === 'string') return /authoriz|authenticat/i.test(auth) && !/unauthoriz|unauthenticat/i.test(auth)
  if (auth !== null && typeof auth === 'object') {
    if (auth.authenticated === true) return true
    if (typeof auth.authenticated === 'boolean') return auth.authenticated
  }
  return false
}

function shortVersion(info) {
  const version = info && typeof info.version === 'string' ? info.version : ''
  if (version === '') return '未知版本'
  const cut = version.split('(')[0].trim()
  return cut.length > 64 ? cut.slice(0, 64) + '…' : cut
}

function shortPath(value) {
  if (typeof value !== 'string' || value === '') return ''
  const normalized = value.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  return index >= 0 ? '…' + normalized.slice(index) : normalized
}

function updateAvailableOf(info) {
  const auth = info && info.auth
  if (auth === null || typeof auth !== 'object') return ''
  const check = auth.version_check
  if (check === null || typeof check !== 'object') return ''
  if (check.status !== 'update_available') return ''
  return typeof check.latest === 'string' ? check.latest : ''
}

function expiryOf(info) {
  const auth = info && info.auth
  if (auth === null || typeof auth !== 'object') return ''
  if (typeof auth.expires_at !== 'string' || auth.expires_at === '') return ''
  return auth.expires_at
}

function hintForAction(provider) {
  return provider === 'wecom' ? '用企业微信扫码完成授权。' : '在浏览器中完成钉钉授权。'
}

// ---------------------------------------------------------------------------
// 1. Inline login row (toolview)
// ---------------------------------------------------------------------------

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

function providerOfRow(block) {
  try {
    const parsed = JSON.parse(textOf(block))
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.provider === 'string') return parsed.provider
  } catch {
    /* ignore */
  }
  return ''
}

function LoginRow(props) {
  const [action, setAction] = React.useState({ busy: false, qrDataUrl: '', hint: '', error: '', done: '' })
  const phase = props.phase
  const children = [React.createElement('div', { style: TITLE, key: 'title' }, '授权登录')]

  if (phase !== 'result') {
    children.push(React.createElement('div', { style: MUTED, key: 'running' },
      phase === 'preparing' ? '正在准备登录…' : '正在发起登录…'))
    return React.createElement('div', { style: ROW }, children)
  }

  const block = props.block
  const images = imageSources(block)
  const text = textOf(block)
  const hint = hintOf(text)
  const provider = providerOfRow(block)
  const markdownQr = (() => {
    try {
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === 'object' && typeof parsed.qrPath === 'string' ? parsed.qrPath : ''
    } catch {
      return ''
    }
  })()

  if (images.length > 0) {
    const gallery = props.renderSlot !== undefined && props.loadImage !== undefined
      ? props.renderSlot('tool.call.images', { images, loadImage: props.loadImage, align: 'start' })
      : React.createElement('div', { style: MUTED, key: 'qr-missing' }, '二维码已生成，可在工具结果中查看 qrPath')
    children.push(React.createElement('div', { key: 'images' }, gallery))
  }
  if (action.qrDataUrl !== '') {
    children.push(React.createElement('img', {
      key: 'qr-action',
      src: action.qrDataUrl,
      alt: '登录二维码',
      style: { width: '180px', height: '180px', borderRadius: '8px', background: '#fff', padding: '6px' },
    }))
  }
  if (hint !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'hint' }, hint))
  } else if (text !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'text' }, text.slice(0, 800)))
  }
  if (action.hint !== '') children.push(React.createElement('div', { style: MUTED, key: 'action-hint' }, action.hint))
  if (action.error !== '') children.push(React.createElement('div', { style: MUTED, key: 'action-error' }, action.error))
  if (action.done !== '') children.push(React.createElement('div', { style: { ...MUTED, color: 'var(--dsw-alias-state-success-primary, #2ecc71)' }, key: 'done' }, action.done))

  if (provider !== '') {
    const refresh = async () => {
      setAction(current => ({ ...current, busy: true, error: '' }))
      try {
        const data = await getJson(`/api/im-connector/login-status?provider=${encodeURIComponent(provider)}`)
        setAction(current => ({
          ...current,
          busy: false,
          done: data.authorized ? '已登录 ✓' : data.running ? '等待扫码中…' : '尚未登录',
          qrDataUrl: typeof data.qrDataUrl === 'string' ? data.qrDataUrl : current.qrDataUrl,
        }))
      } catch (error) {
        setAction(current => ({ ...current, busy: false, error: String((error && error.message) || error) }))
      }
    }
    const relogin = async () => {
      setAction(current => ({ ...current, busy: true, error: '', done: '' }))
      try {
        const data = await postJson('/api/im-connector/login', { provider })
        setAction({
          busy: false,
          qrDataUrl: typeof data.qrDataUrl === 'string' ? data.qrDataUrl : '',
          hint: typeof data.hint === 'string' ? data.hint : hintForAction(provider),
          error: '',
          done: '',
        })
      } catch (error) {
        setAction(current => ({ ...current, busy: false, error: String((error && error.message) || error) }))
      }
    }
    children.push(React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, key: 'actions' },
      React.createElement('button', { type: 'button', style: BUTTON, disabled: action.busy, onClick: relogin }, action.busy ? '请稍候…' : '重新登录'),
      React.createElement('button', { type: 'button', style: BUTTON, disabled: action.busy, onClick: refresh }, '刷新状态'),
      markdownQr !== '' ? React.createElement('span', { style: LABEL }, '二维码文件：' + shortPath(markdownQr)) : null,
    ))
  }
  return React.createElement('div', { style: ROW }, children)
}

// ---------------------------------------------------------------------------
// 2. Settings page
// ---------------------------------------------------------------------------

function ProviderCard(props) {
  const { info, session } = props
  const authorized = authorizedOf(info)
  const update = updateAvailableOf(info)
  const expiry = expiryOf(info)
  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: TITLE }, info.displayName || info.id),
      React.createElement('span', { style: authorized ? PILL_OK : PILL_WARN }, authorized ? '已登录' : '未登录'),
      info.bundled ? React.createElement('span', { style: PILL_INFO }, '内置二进制') : null,
      update !== '' ? React.createElement('span', { style: PILL_WARN }, '可升级 ' + update) : null,
    ),
    React.createElement('div', { style: LABEL, key: 'version' }, shortVersion(info)),
  ]
  const path = shortPath(info.resolved)
  if (path !== '') children.push(React.createElement('div', { style: LABEL, key: 'path' }, '入口：' + path))
  if (expiry !== '') children.push(React.createElement('div', { style: LABEL, key: 'expiry' }, 'Token 有效至：' + expiry))
  if (info.authError !== undefined) {
    children.push(React.createElement('div', { style: MUTED, key: 'auth-error' }, info.authError))
  }

  children.push(React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, key: 'actions' },
    React.createElement('button', {
      type: 'button',
      style: BUTTON_PRIMARY,
      disabled: Boolean(session && session.busy),
      onClick: () => props.onLogin(info.id),
    }, session && session.busy ? '登录中…' : authorized ? '重新登录' : '登录'),
    React.createElement('button', {
      type: 'button',
      style: BUTTON,
      onClick: () => props.onRefresh(),
    }, '刷新'),
  ))

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
    if (session.outputTail) children.push(React.createElement('div', { style: MUTED, key: 'tail' }, session.outputTail))
  }

  return React.createElement('div', { style: CARD }, children)
}

function ConfigEditor(props) {
  const { providers, config, onSaved } = props
  const [bins, setBins] = React.useState(() => {
    const initial = {}
    for (const info of providers) initial[info.id] = (config && config.bins && config.bins[info.id]) || ''
    return initial
  })
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    const next = {}
    for (const info of providers) next[info.id] = (config && config.bins && config.bins[info.id]) || ''
    setBins(next)
  }, [config, providers])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const payload = { bins: {}, defaultProvider: config && config.defaultProvider }
      for (const info of providers) {
        const value = (bins[info.id] || '').trim()
        if (value !== '') payload.bins[info.id] = value
      }
      if (!payload.defaultProvider) delete payload.defaultProvider
      const data = await putJson('/api/im-connector/config', payload)
      setMessage('已保存：' + (data.path || ''))
      if (onSaved) onSaved()
    } catch (error) {
      setMessage('保存失败：' + String((error && error.message) || error))
    } finally {
      setSaving(false)
    }
  }

  const children = [
    React.createElement('div', { style: SECTION_TITLE, key: 'title' }, '配置'),
    React.createElement('div', { style: LABEL, key: 'desc' },
      '可覆盖每个平台的 CLI 入口（等价于 DINGTALK_DWS_BIN / WECOM_CLI_BIN），留空表示自动解析。保存后立即生效于 MCP 工具与设置页。'),
  ]
  for (const info of providers) {
    children.push(React.createElement('label', { key: info.id, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      React.createElement('span', { style: LABEL }, `${info.displayName || info.id} 的 CLI 入口`),
      React.createElement('input', {
        style: INPUT,
        value: bins[info.id] || '',
        placeholder: '自动解析（留空）',
        onChange: event => setBins(current => ({ ...current, [info.id]: event.target.value })),
      }),
    ))
  }
  children.push(React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, key: 'actions' },
    React.createElement('button', { type: 'button', style: BUTTON_PRIMARY, disabled: saving, onClick: save }, saving ? '保存中…' : '保存配置'),
    message !== '' ? React.createElement('span', { style: LABEL }, message) : null,
  ))
  return React.createElement('div', { style: CARD }, children)
}

const RESOURCE_TABS = [
  { uri: 'im://dingtalk/services', label: '钉钉服务域' },
  { uri: 'im://dingtalk/templates', label: '日志模板' },
  { uri: 'im://wecom/sessions', label: '企微最近会话' },
]

function ResourceBrowser() {
  const [active, setActive] = React.useState('')
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const load = async uri => {
    setActive(uri)
    setBusy(true)
    setError('')
    setText('')
    try {
      const data = await getJson(`/api/im-connector/resources?uri=${encodeURIComponent(uri)}`)
      setText(typeof data.text === 'string' ? data.text : '')
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setBusy(false)
    }
  }

  const children = [
    React.createElement('div', { style: SECTION_TITLE, key: 'title' }, '资源浏览'),
    React.createElement('div', { style: LABEL, key: 'desc' },
      '只读查看当前 CLI 能提供的能力（等价于 MCP 资源 im://…）。'),
    React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, key: 'tabs' },
      ...RESOURCE_TABS.map(tab => React.createElement('button', {
        key: tab.uri,
        type: 'button',
        style: active === tab.uri ? BUTTON_PRIMARY : BUTTON,
        onClick: () => { load(tab.uri) },
      }, tab.label)),
    ),
  ]
  if (busy) children.push(React.createElement('div', { style: MUTED, key: 'busy' }, '加载中…'))
  if (error !== '') children.push(React.createElement('div', { style: MUTED, key: 'error' }, error))
  if (text !== '') {
    children.push(React.createElement('pre', {
      key: 'text',
      style: {
        margin: 0,
        maxHeight: '240px',
        overflow: 'auto',
        fontSize: '11px',
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: 'var(--dsw-alias-bg-l2, rgba(128,128,128,0.06))',
        borderRadius: '8px',
        padding: '8px',
      },
    }, text))
  }
  return React.createElement('div', { style: CARD }, children)
}

function SettingsPage() {
  const [state, setState] = React.useState({ loading: true, error: '', providers: [], version: '', config: {} })
  const [sessions, setSessions] = React.useState({})
  const [copied, setCopied] = React.useState('')

  const refresh = React.useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: '' }))
    try {
      const [info, config] = await Promise.all([
        getJson('/api/im-connector/info'),
        getJson('/api/im-connector/config').catch(() => ({ config: {} })),
      ])
      setState({
        loading: false,
        error: '',
        providers: Array.isArray(info.providers) ? info.providers : [],
        version: typeof info.version === 'string' ? info.version : '',
        config: config && typeof config.config === 'object' ? config.config : {},
      })
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: String((error && error.message) || error) }))
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  React.useEffect(() => {
    const running = Object.keys(sessions).filter(key => sessions[key] && sessions[key].running)
    if (running.length === 0) return undefined
    const timer = setInterval(async () => {
      for (const provider of running) {
        try {
          const data = await getJson(`/api/im-connector/login-status?provider=${encodeURIComponent(provider)}`)
          if (data.authorized || !data.running) {
            setSessions(current => ({ ...current, [provider]: undefined }))
            refresh()
          }
        } catch {
          /* keep waiting through transient failures */
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [sessions, refresh])

  const startLogin = React.useCallback(async provider => {
    setSessions(current => ({ ...current, [provider]: { busy: true, running: true } }))
    try {
      const data = await postJson('/api/im-connector/login', { provider })
      setSessions(current => ({
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
      setSessions(current => ({
        ...current,
        [provider]: { busy: false, running: false, error: String((error && error.message) || error) },
      }))
    }
  }, [])

  const copyDiagnostics = async () => {
    try {
      const payload = JSON.stringify({ version: state.version, providers: state.providers }, null, 2)
      await navigator.clipboard.writeText(payload)
      setCopied('已复制到剪贴板')
    } catch (error) {
      setCopied('复制失败：' + String((error && error.message) || error))
    }
  }

  const authorizedCount = state.providers.filter(authorizedOf).length
  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: { fontSize: '15px', fontWeight: 600 } }, 'IM 连接器'),
      React.createElement('span', { style: state.providers.length > 0 && authorizedCount === state.providers.length ? PILL_OK : PILL_WARN },
        `${authorizedCount}/${state.providers.length} 已登录`),
      state.version !== '' ? React.createElement('span', { style: LABEL }, 'v' + state.version) : null,
      state.loading ? React.createElement('span', { style: LABEL }, '检测中…') : null,
    ),
    React.createElement('div', { style: LABEL, key: 'desc' },
      '钉钉（dws）与企业微信（wecom-cli）的 Agent 侧连接：查看 CLI 版本与登录状态，扫码登录后立即生效。'),
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
  children.push(React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }, key: 'diag' },
    React.createElement('button', { type: 'button', style: BUTTON, onClick: copyDiagnostics }, '复制诊断信息'),
    copied !== '' ? React.createElement('span', { style: LABEL }, copied) : null,
  ))
  children.push(React.createElement(ConfigEditor, {
    key: 'config',
    providers: state.providers,
    config: state.config,
    onSaved: refresh,
  }))
  children.push(React.createElement(ResourceBrowser, { key: 'resources' }))
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '24px' } }, children)
}

// ---------------------------------------------------------------------------
// 3. Session header chip
// ---------------------------------------------------------------------------

function StatusChip() {
  const [state, setState] = React.useState({ loaded: false, authorized: 0, total: 0, detail: '' })

  const load = React.useCallback(async () => {
    try {
      const data = await getJson('/api/im-connector/info')
      const providers = Array.isArray(data.providers) ? data.providers : []
      const authorized = providers.filter(authorizedOf).length
      const detail = providers
        .map(info => `${info.displayName || info.id}: ${authorizedOf(info) ? '已登录' : '未登录'}`)
        .join(' · ')
      setState({ loaded: true, authorized, total: providers.length, detail })
    } catch {
      setState(current => ({ ...current, loaded: true, detail: 'IM 连接器状态不可用' }))
    }
  }, [])

  React.useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  const ok = state.total > 0 && state.authorized === state.total
  const text = state.loaded ? `IM ${state.authorized}/${state.total}` : 'IM …'
  return React.createElement('button', {
    type: 'button',
    title: state.detail || 'IM 连接器',
    onClick: load,
    style: {
      ...BUTTON,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 10px',
      fontSize: '11px',
      opacity: state.loaded ? 1 : 0.7,
    },
  },
  React.createElement('span', {
    style: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: ok ? 'var(--dsw-alias-state-success-primary, #2ecc71)' : 'var(--dsw-alias-state-warn-primary, #f5a623)',
      display: 'inline-block',
    },
  }),
  text)
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

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'im-connector-status',
    order: 11,
  }, StatusChip))
}
