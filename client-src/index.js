// im-connector client plugin (browser half).
//
// Surfaces:
// 1. `settings.section` — "IM 连接器" page: per-platform login status and a
//    QR login flow (WeCom shows the QR here; DingTalk opens the browser).
// 2. `conversation.session.header.utilities` — a compact IM status chip.
// 3. `tool.call.toolview` for `mcp__im__login` — inline QR + quick actions.
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
  padding: '14px 16px',
  borderRadius: '12px',
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
const ERROR_TEXT = { ...MUTED, color: 'var(--dsw-alias-state-error-primary, #e5484d)' }
const HEADING = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
const PILL = base => ({ fontSize: '11px', padding: '1px 8px', borderRadius: '999px', color: '#fff', ...base })
const PILL_OK = PILL({ background: 'var(--dsw-alias-state-success-primary, #2ecc71)' })
const PILL_WARN = PILL({ background: 'var(--dsw-alias-state-warn-primary, #f5a623)' })
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

// ---------------------------------------------------------------------------
// HTTP + status helpers
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
    const reason = data && typeof data.error === 'string' ? data.error : `请求失败 (${response.status})`
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

// 平台检测的共享缓存（chip 与设置页共用）：TTL 内直接复用，避免重复检测。
// fresh=true 时带 ?fresh=1 绕过服务端缓存强制重检。
let sharedInfo = { at: 0, providers: [] }
async function fetchInfo(fresh) {
  if (!fresh && sharedInfo.providers.length > 0 && Date.now() - sharedInfo.at < 25000) {
    return sharedInfo
  }
  const data = await getJson('/api/im-connector/info' + (fresh ? '?fresh=1' : ''))
  sharedInfo = {
    at: Date.now(),
    providers: Array.isArray(data.providers) ? data.providers : [],
  }
  return sharedInfo
}

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

// ---------------------------------------------------------------------------
// 1. Settings page
// ---------------------------------------------------------------------------

function ProviderCard(props) {
  const { info, session } = props
  const authorized = authorizedOf(info)
  const busy = Boolean(session && session.busy)
  const running = Boolean(session && session.running)

  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, info.displayName || info.id),
      React.createElement('span', { style: authorized ? PILL_OK : PILL_WARN }, authorized ? '已登录' : '未登录'),
    ),
  ]

  // 登录中：显示二维码 + 扫码提示（企微为 CLI 生成的二维码，钉钉为设备码短链生成的二维码）
  if (running && !session.error) {
    if (session.qrDataUrl) {
      children.push(React.createElement('img', {
        key: 'qr',
        src: session.qrDataUrl,
        alt: '登录二维码',
        style: { width: '190px', height: '190px', borderRadius: '10px', background: '#fff', padding: '8px', alignSelf: 'flex-start' },
      }))
      children.push(React.createElement('div', { style: LABEL, key: 'qr-hint' },
        `请用${info.displayName}扫码，在手机上确认授权`))
      if (session.userCode) {
        children.push(React.createElement('div', { style: LABEL, key: 'user-code' },
          `验证码：${session.userCode}`))
      }
    } else {
      children.push(React.createElement('div', { style: MUTED, key: 'waiting' },
        session.hint || '正在发起登录…'))
    }
  }
  // 失败 / 中断：保留原因，不静默消失
  if (session && session.error) {
    children.push(React.createElement('div', { style: ERROR_TEXT, key: 'error' }, session.error))
    if (session.outputTail) {
      children.push(React.createElement('details', { key: 'detail', style: { fontSize: '12px' } },
        React.createElement('summary', { style: LABEL }, '详细信息'),
        React.createElement('pre', {
          style: { margin: '6px 0 0', fontSize: '11px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        }, session.outputTail),
      ))
    }
  }
  // 刚授权成功的提示
  if (session && session.done) {
    children.push(React.createElement('div', {
      key: 'done',
      style: { ...MUTED, color: 'var(--dsw-alias-state-success-primary, #2ecc71)' },
    }, session.done))
  }

  children.push(React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, key: 'actions' },
    React.createElement('button', {
      type: 'button',
      style: BUTTON_PRIMARY,
      disabled: busy || running,
      onClick: () => props.onLogin(info.id),
    }, busy ? '请稍候…' : running ? '等待授权…' : authorized ? '重新登录' : '登录'),
    React.createElement('button', {
      type: 'button',
      style: BUTTON,
      onClick: () => props.onRefresh(),
    }, '刷新'),
  ))

  return React.createElement('div', { style: CARD }, children)
}

function SettingsPage() {
  const [state, setState] = React.useState({ loading: true, error: '', providers: [] })
  const [sessions, setSessions] = React.useState({})

  const refresh = React.useCallback(async fresh => {
    // 已有数据时保持卡片可见，不闪「检测中」；只有首次加载才显示检测态
    setState(current => (current.providers.length > 0 ? current : { ...current, loading: true, error: '' }))
    try {
      const data = await fetchInfo(Boolean(fresh))
      setState({
        loading: false,
        error: '',
        providers: data.providers,
      })
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: String((error && error.message) || error) }))
    }
  }, [])

  React.useEffect(() => {
    refresh(false)
  }, [refresh])

  // 轮询进行中的登录：先看会话是否仍在运行，再看授权结果。
  // （authorized 由服务端按登录进程退出码判定；running 期间不收起二维码）
  React.useEffect(() => {
    const running = Object.keys(sessions).filter(key => sessions[key] && sessions[key].running)
    if (running.length === 0) return undefined
    let cancelled = false
    const timer = setInterval(async () => {
      if (cancelled) return
      for (const provider of running) {
        try {
          const data = await getJson(`/api/im-connector/login-status?provider=${encodeURIComponent(provider)}`)
          if (data.running) {
            // 仍在等待扫码 / 浏览器授权：保持二维码与提示
          } else if (data.authorized) {
            setSessions(current => ({ ...current, [provider]: { done: '登录成功' } }))
            refresh(true)
            setTimeout(() => {
              setSessions(current => (current[provider] && current[provider].done ? { ...current, [provider]: undefined } : current))
            }, 4000)
          } else {
            const tail = typeof data.outputTail === 'string' ? data.outputTail.trim() : ''
            const reasonFromTail = (() => {
              const match = tail.match(/"message"\s*:\s*"([^"]+)"/)
              return match ? match[1] : ''
            })()
            setSessions(current => ({
              ...current,
              [provider]: {
                running: false,
                error: (reasonFromTail || (data.exitCode === 0 ? '授权流程已结束，但尚未登录成功。' : '登录已中断，请重新登录。')),
                outputTail: tail,
              },
            }))
            refresh()
          }
        } catch {
          /* 轮询中的瞬时失败忽略，继续等待 */
        }
      }
    }, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessions, refresh])

  const startLogin = React.useCallback(async provider => {
    setSessions(current => ({ ...current, [provider]: { busy: true, running: true } }))
    try {
      // 设备码模式：钉钉在页面内出二维码（手机扫码确认），企微不受影响
      const data = await postJson('/api/im-connector/login', { provider, mode: 'device' })
      setSessions(current => ({
        ...current,
        [provider]: {
          busy: false,
          running: Boolean(data.running),
          qrDataUrl: data.qrDataUrl,
          userCode: data.userCode,
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

  const authorizedCount = state.providers.filter(authorizedOf).length
  const children = [
    React.createElement('div', { style: HEADING, key: 'head' },
      React.createElement('div', { style: { fontSize: '15px', fontWeight: 600 } }, 'IM 连接器'),
      state.providers.length > 0
        ? React.createElement('span', { style: authorizedCount === state.providers.length ? PILL_OK : PILL_WARN },
          `${authorizedCount}/${state.providers.length} 已登录`)
        : null,
      state.loading ? React.createElement('span', { style: LABEL }, '检测中…') : null,
    ),
  ]
  if (state.error) {
    children.push(React.createElement('div', { style: ERROR_TEXT, key: 'error' }, state.error))
  }
  for (const info of state.providers) {
    children.push(React.createElement(ProviderCard, {
      key: info.id,
      info,
      session: sessions[info.id],
      onLogin: startLogin,
      onRefresh: () => { refresh(true) },
    }))
  }
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '24px' } }, children)
}

// ---------------------------------------------------------------------------
// 2. Session header chip
// ---------------------------------------------------------------------------

function StatusChip() {
  const [state, setState] = React.useState({ loaded: false, authorized: 0, total: 0, detail: '' })

  const load = React.useCallback(async () => {
    try {
      const data = await fetchInfo(false)
      const providers = data.providers
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
  state.loaded ? `IM ${state.authorized}/${state.total}` : 'IM …')
}

// ---------------------------------------------------------------------------
// 3. Inline login row (toolview)
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

function fieldOf(block, key) {
  try {
    const parsed = JSON.parse(textOf(block))
    if (parsed !== null && typeof parsed === 'object') return parsed[key]
  } catch {
    /* not JSON */
  }
  return undefined
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
  const hint = fieldOf(block, 'hint')
  const provider = fieldOf(block, 'provider')
  const qrPath = fieldOf(block, 'qrPath')

  if (images.length > 0) {
    const gallery = props.renderSlot !== undefined && props.loadImage !== undefined
      ? props.renderSlot('tool.call.images', { images, loadImage: props.loadImage, align: 'start' })
      : React.createElement('div', { style: MUTED, key: 'qr-missing' }, '二维码已生成（见工具结果中的 qrPath）')
    children.push(React.createElement('div', { key: 'images' }, gallery))
  }
  if (typeof hint === 'string' && hint !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'hint' }, hint))
  } else if (text !== '') {
    children.push(React.createElement('div', { style: MUTED, key: 'text' }, text.slice(0, 400)))
  }
  if (action.qrDataUrl !== '') {
    children.push(React.createElement('img', {
      key: 'qr-action',
      src: action.qrDataUrl,
      alt: '登录二维码',
      style: { width: '180px', height: '180px', borderRadius: '8px', background: '#fff', padding: '6px' },
    }))
  }
  if (action.hint !== '') children.push(React.createElement('div', { style: MUTED, key: 'action-hint' }, action.hint))
  if (action.error !== '') children.push(React.createElement('div', { style: ERROR_TEXT, key: 'action-error' }, action.error))
  if (action.done !== '') children.push(React.createElement('div', {
    key: 'done',
    style: { ...MUTED, color: 'var(--dsw-alias-state-success-primary, #2ecc71)' },
  }, action.done))

  if (typeof provider === 'string' && provider !== '') {
    const refresh = async () => {
      setAction(current => ({ ...current, busy: true, error: '' }))
      try {
        const data = await getJson(`/api/im-connector/login-status?provider=${encodeURIComponent(provider)}`)
        setAction(current => ({
          ...current,
          busy: false,
          done: data.authorized ? '已登录 ✓' : data.running ? '等待扫码中…' : '尚未登录',
          qrDataUrl: typeof data.qrDataUrl === 'string' && data.qrDataUrl ? data.qrDataUrl : current.qrDataUrl,
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
          hint: typeof data.hint === 'string' ? data.hint : '',
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
    ))
  }
  return React.createElement('div', { style: ROW }, children)
}

export function apply(ctx) {
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

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'mcp__im__login',
    children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
  }, LoginRow))
}
