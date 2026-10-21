window.__ModuleLoader__.load({
  id: '@local/im-connect',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const style = {
      card: {
        display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 0',
        color: 'var(--dsw-alias-text-primary, #1f2329)', fontSize: '14px',
      },
      row: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
        border: '1px solid var(--dsw-alias-border, #e5e6eb)', borderRadius: '8px',
        flexWrap: 'wrap',
      },
      name: { fontWeight: 600, minWidth: '96px' },
      badge: (connected) => ({
        fontSize: '12px', padding: '2px 8px', borderRadius: '999px',
        background: connected ? 'rgba(56,158,13,.12)' : 'rgba(207,19,34,.1)',
        color: connected ? '#389e0d' : '#cf1322',
      }),
      button: {
        padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #e5e6eb)',
        background: 'var(--dsw-alias-bg-container, #fff)', cursor: 'pointer', fontSize: '13px',
      },
      toggleOn: (on) => ({
        padding: '6px 14px', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer',
        fontSize: '13px', color: '#fff', background: on ? '#1677ff' : '#bfbfbf',
      }),
      qrBox: {
        width: '100%', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
        alignItems: 'center', padding: '12px', background: '#fff', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border, #e5e6eb)',
      },
      qrImg: { display: 'block', width: 220, height: 220 },
      qrHint: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #86909c)', margin: '0', wordBreak: 'break-all' },
      pre: {
        width: '100%', margin: '8px 0 0', padding: '10px', background: '#0b0e14', color: '#e8f4ff',
        borderRadius: '8px', fontSize: '12px', lineHeight: 1.35, overflow: 'auto', maxHeight: '200px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      },
      hint: { color: 'var(--dsw-alias-text-secondary, #86909c)', fontSize: '13px', margin: '0' },
      title: { fontSize: '16px', fontWeight: 700, margin: '0' },
      pendingRow: {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
        border: '1px solid var(--dsw-alias-border, #e5e6eb)', borderRadius: '8px', flexWrap: 'wrap',
      },
      pendingText: { flex: '1 1 220px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      approve: { ...null, padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#fff', background: '#389e0d' },
      reject: { padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#fff', background: '#cf1322' },
    };

    function LoginPanel({ login }) {
      if (!login) return null;
      if (login.done) {
        return h('p', { style: style.hint }, `登录进程已结束（exit=${login.exitCode}）。`);
      }
      return h('div', { style: style.qrBox },
        login.url ? h('img', { style: style.qrImg, src: '/im-connect/api/qr.png?t=' + encodeURIComponent(login.startedAt || Date.now()), alt: '登录二维码' }) : null,
        login.url ? h('p', { style: style.qrHint }, '用钉钉/企业微信扫码，或打开链接：' + login.url) : null,
        h('pre', { style: style.pre }, login.output || '等待二维码…'),
      );
    }

    function ProviderRow({ p, login, onToggle, onLogin }) {
      const [busy, setBusy] = useState(false);
      const toggle = async () => {
        setBusy(true);
        try {
          await fetch('/im-connect/api/receive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: p.id, enabled: !p.receive }),
          });
          onToggle();
        } catch (e) {
          /* 由外层刷新提示 */
        } finally {
          setBusy(false);
        }
      };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: style.row },
          h('span', { style: style.name }, p.displayName),
          h('span', { style: style.badge(p.connected) }, p.connected ? '已连接' : '未连接'),
          h('button', {
            style: style.toggleOn(p.receive), onClick: toggle, disabled: busy,
            role: 'switch', 'aria-checked': p.receive,
          }, p.receive ? '接收开' : '接收关'),
          h('button', { style: style.button, onClick: () => onLogin(p.id) }, '扫码登录'),
        ),
        h(LoginPanel, { login }),
      );
    }

    function PendingList({ pending, onChanged }) {
      if (!pending || pending.length === 0) return null;
      const decide = async (p, approved) => {
        await fetch('/im-connect/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: p.provider, senderId: p.senderId, approved }),
        });
        onChanged();
      };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('h4', { style: { margin: '12px 0 0', fontSize: '14px' } }, `待批准私聊（${pending.length}）`),
        pending.map((p) => h('div', { key: p.provider + ':' + p.senderId, style: style.pendingRow },
          h('span', { style: style.name }, p.provider === 'dingtalk' ? '钉钉' : '企业微信'),
          h('span', { style: style.pendingText }, (p.senderName || p.senderId) + '：' + p.lastText),
          h('button', { style: style.approve, onClick: () => decide(p, true) }, '批准'),
          h('button', { style: style.reject, onClick: () => decide(p, false) }, '拒绝'),
        )),
      );
    }

    function ImConnectSettings() {
      const [state, setState] = useState({ providers: [], pending: [] });
      const [login, setLogin] = useState(null);
      const [error, setError] = useState(null);

      const refresh = useCallback(() => {
        fetch('/im-connect/api/state')
          .then((r) => r.json())
          .then((s) => { setError(null); setState(s); })
          .catch((e) => setError(String(e)));
      }, []);

      useEffect(() => {
        refresh();
        const t = setInterval(refresh, 8000);
        return () => clearInterval(t);
      }, [refresh]);

      useEffect(() => {
        if (!login || login.done) return undefined;
        const t = setInterval(() => {
          fetch('/im-connect/api/login-status')
            .then((r) => r.json())
            .then((s) => {
              setLogin({ provider: s.provider, output: s.output, done: s.done, running: s.running, exitCode: s.exitCode, url: s.url, startedAt: s.startedAt });
              if (s.done) refresh();
            })
            .catch(() => {});
        }, 2000);
        return () => clearInterval(t);
      }, [login ? login.provider : null, login ? login.running : null]);

      const startLogin = (provider) => {
        fetch('/im-connect/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        }).catch((e) => setError(String(e)));
        setLogin({ provider, output: '', done: false, running: true, exitCode: null, url: null, startedAt: Date.now() });
      };

      return h('div', { style: style.card },
        h('h3', { style: style.title }, 'IM 连接'),
        h('p', { style: style.hint }, '扫码登录后开启「接收」，即可在钉钉 / 企业微信里 @ 机器人驱动本机 DSH；私聊需在下方批准。'),
        error ? h('p', { style: { color: '#cf1322', fontSize: '13px' } }, `无法连接本机服务：${error}`) : null,
        (state.providers || []).map((p) => h(ProviderRow, {
          key: p.id,
          p,
          login: login && login.provider === p.id ? login : null,
          onToggle: refresh,
          onLogin: startLogin,
        })),
        h(PendingList, { pending: state.pending || [], onChanged: refresh }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'im-connect', order: 10, label: 'IM 连接' },
          ImConnectSettings,
        ));
      },
    };
  },
});
