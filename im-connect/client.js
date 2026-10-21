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
      qr: {
        width: '100%', margin: '8px 0 0', padding: '12px', background: '#0b0e14', color: '#e8f4ff',
        borderRadius: '8px', fontSize: '12px', lineHeight: 1.35, overflow: 'auto', maxHeight: '260px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      },
      hint: { color: 'var(--dsw-alias-text-secondary, #86909c)', fontSize: '13px', margin: '0' },
      title: { fontSize: '16px', fontWeight: 700, margin: '0' },
    };

    function ProviderRow({ p, login, onToggle, onLogin }) {
      const [busy, setBusy] = useState(false);
      const toggle = async () => {
        setBusy(true);
        try {
          await fetch('/im-connect/receive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: p.id, enabled: !p.receive }),
          });
          onToggle();
        } catch (e) {
          // 刷新时由外层展示错误
        } finally {
          setBusy(false);
        }
      };
      return h('div', { style: style.row },
        h('span', { style: style.name }, p.displayName),
        h('span', { style: style.badge(p.connected) }, p.connected ? '已连接' : '未连接'),
        h('button', {
          style: style.toggleOn(p.receive), onClick: toggle, disabled: busy,
          role: 'switch', 'aria-checked': p.receive,
        }, p.receive ? '接收开' : '接收关'),
        h('button', { style: style.button, onClick: () => onLogin(p.id) }, '扫码登录'),
        login
          ? h('pre', { style: style.qr }, login.running ? (login.output || '等待二维码…') : (login.done ? `登录进程已结束（exit=${login.exitCode}）\n\n${login.output}` : login.output))
          : null,
      );
    }

    function ImConnectSettings() {
      const [state, setState] = useState({ providers: [] });
      const [login, setLogin] = useState(null);
      const [error, setError] = useState(null);

      const refresh = useCallback(() => {
        fetch('/im-connect/state')
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
          fetch('/im-connect/login-status')
            .then((r) => r.json())
            .then((s) => {
              setLogin({ provider: s.provider, output: s.output, done: s.done, running: s.running, exitCode: s.exitCode });
              if (s.done) refresh();
            })
            .catch(() => {});
        }, 2000);
        return () => clearInterval(t);
      }, [login ? login.provider : null, login ? login.running : null]);

      const startLogin = (provider) => {
        fetch('/im-connect/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        }).catch((e) => setError(String(e)));
        setLogin({ provider, output: '', done: false, running: true, exitCode: null });
      };

      return h('div', { style: style.card },
        h('h3', { style: style.title }, 'IM 连接'),
        h('p', { style: style.hint }, '扫码登录后开启「接收」，即可在钉钉 / 企业微信里 @ 机器人驱动本机 DSH，并在原会话接收回复。'),
        error ? h('p', { style: { color: '#cf1322', fontSize: '13px' } }, `无法连接本机服务：${error}`) : null,
        (state.providers || []).map((p) => h(ProviderRow, {
          key: p.id,
          p,
          login: login && login.provider === p.id ? login : null,
          onToggle: refresh,
          onLogin: startLogin,
        })),
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
