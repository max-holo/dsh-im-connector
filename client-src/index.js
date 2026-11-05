// im-connector client plugin: render the im login tool row inline.
//
// The MCP tool `mcp__im__login` returns a QR image as MCP image content, which
// the harness stores as a durable attachment. The generic tool card would show
// it behind the attachment preview; this toolview claims the tool's keyed slot
// and renders the QR through the tool-owned `tool.call.images` gallery, so the
// code is visible directly in the chat row.
//
// Source of the built artifact `lib/client.js`; see scripts/build-client.mjs.
import React from 'react'

export const name = 'im-connector-client'
export const inject = ['slots']

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
const MUTED = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary, #8a8a92)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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

export function apply(ctx) {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'mcp__im__login',
    children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
  }, LoginRow))
}
