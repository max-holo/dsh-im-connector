window.__ModuleLoader__.load({
  id: '@local/im-connect',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const style = {
      card: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 0', color: 'var(--dsw-alias-text-primary, #1f2329)', fontSize: '14px' },
      row: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', border: '1px solid var(--dsw-alias-border, #e5e6eb)', borderRadius: '8px', flexWrap: 'wrap' },
      name: { fontWeight: 600, minWidth: '72px' },
      badge: (ok) => ({ fontSize: '12px', padding: '2px 8px', borderRadius: '999px', background: ok ? 'rgba(56,158,13,.12)' : 'rgba(207,19,34,.1)', color: ok ? '#389e0d' : '#cf1322' }),
      button: { padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #e5e6eb)', background: 'var(--dsw-alias-bg-container, #fff)', cursor: 'pointer', fontSize: '13px' },
      toggleOn: (on) => ({ padding: '6px 14px', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', color: '#fff', background: on ? '#1677ff' : '#bfbfbf' }),
      panel: { width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', padding: '12px', background: 'var(--dsw-alias-bg-container, #fff)', borderRadius: '8px', border: '1px solid var(--dsw-alias-border, #e5e6eb)' },
      qrImg: { display: 'block', width: 220, height: 220 },
      qrHint: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #86909c)', margin: '0', wordBreak: 'break-all' },
      hint: { color: 'var(--dsw-alias-text-secondary, #86909c)', fontSize: '13px', margin: '0' },
      err: { color: '#cf1322', fontSize: '13px', margin: '0' },
      ok: { color: '#389e0d', fontSize: '13px', margin: '0' },
      pre: { width: '100%', margin: '6px 0 0', padding: '10px', background: '#0b0e14', color: '#e8f4ff', borderRadius: '8px', fontSize: '12px', lineHeight: 1.35, overflow: 'auto', maxHeight: '180px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
      title: { fontSize: '16px', fontWeight: 700, margin: '0' },
      note: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #86909c)', margin: '4px 0 0', lineHeight: 1.5 },
      pendingRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', border: '1px solid var(--dsw-alias-border, #e5e6eb)', borderRadius: '8px', flexWrap: 'wrap' },
      pendingText: { flex: '1 1 220px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      approve: { padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#fff', background: '#389e0d' },
      reject: { padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#fff', background: '#cf1322' },
    };

    function LoginPanel({ login, onClose, onRetry }) {
      if (!login) return null;
      if (login.state === 'waiting') {
        return h('div', { style: style.panel },
          login.url ? h('img', { style: style.qrImg, src: '/im-connect/api/qr.png?t=' + encodeURIComponent(login.startedAt || Date.now()), alt: '登录二维码' }) : null,
          h('p', { style: style.hint }, '用手机扫码完成授权（等待中…）'),
          login.url ? h('p', { style: style.qrHint }, '或打开链接：' + login.url) : null,
          h('button', { style: style.button, onClick: onClose }, '取消'),
        );
      }
      if (login.state === 'authorized') {
        return h('div', { style: style.panel },
          h('p', { style: style.ok }, '✅ 授权完成，已连接'),
          h('button', { style: style.button, onClick: onClose }, '关闭'),
        );
      }
      return h('div', { style: style.panel },
        h('p', { style: style.err }, login.error || (login.state === 'timeout' ? '登录超时' : '登录失败')),
        h('pre', { style: style.pre }, login.output || '（无输出）'),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { style: style.button, onClick: onRetry }, '重新登录'),
          h('button', { style: style.button, onClick: onClose }, '关闭'),
        ),
      );
    }

    function ProviderRow({ p, login }) {
      const [busy, setBusy] = useState(false);
      const onToggle = () => {
        fetch('/im-connect/api/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p.id, enabled: !p.receive }) }).catch(() => {});
      };
      const onLogin = () => {
        fetch('/im-connect/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p.id }) }).catch(() => {});
        p._startLogin();
      };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: style.row },
          h('span', { style: style.name }, p.displayName),
          h('span', { style: style.badge(p.connected) }, p.connected ? '已连接' : '未连接'),
          p.account ? h('span', { style: style.hint }, p.account) : null,
          h('button', { style: style.toggleOn(p.receive), onClick: () => { setBusy(true); onToggle(); setTimeout(() => setBusy(false), 400); }, disabled: busy, role: 'switch', 'aria-checked': p.receive }, p.receive ? '接收开' : '接收关'),
          h('button', { style: style.button, onClick: onLogin }, '扫码登录'),
        ),
        p.receiveHealth && !p.receiveHealth.ok ? h('p', { style: style.err }, `⚠️ 接收不可用：${p.receiveHealth.reason || '未知原因'}`) : null,
        h(LoginPanel, { login, onClose: p._closeLogin, onRetry: onLogin }),
      );
    }

    function PendingList({ pending, onChanged }) {
      if (!pending || pending.length === 0) return null;
      const decide = async (p, approved) => {
        await fetch('/im-connect/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p.provider, senderId: p.senderId, approved }) });
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
      const [test, setTest] = useState(null);
      const [testing, setTesting] = useState(false);

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
        if (!login || login.state !== 'waiting') return undefined;
        const t = setInterval(() => {
          fetch('/im-connect/api/login-status')
            .then((r) => r.json())
            .then((s) => { setLogin(s); if (s.state !== 'waiting') refresh(); })
            .catch(() => {});
        }, 2000);
        return () => clearInterval(t);
      }, [login ? login.state : null, login ? login.provider : null, refresh]);

      const startLogin = (provider) => {
        setLogin({ state: 'waiting', provider, output: '', startedAt: Date.now(), url: null });
      };
      const closeLogin = () => setLogin(null);

      const providers = (state.providers || []).map((p) => Object.assign({}, p, {
        _startLogin: () => startLogin(p.id),
        _closeLogin: closeLogin,
      }));

      const runTest = () => {
        setTesting(true);
        setTest(null);
        fetch('/im-connect/api/selftest', { method: 'POST' })
          .then((r) => r.json())
          .then((r) => setTest(r))
          .catch((e) => setTest({ ok: false, error: String(e) }))
          .finally(() => setTesting(false));
      };

      return h('div', { style: style.card },
        h('h3', { style: style.title }, 'IM 连接'),
        h('p', { style: style.hint }, '钉钉为「以你的账号代回复」：别人在群里 @你、或私聊你（批准后），DSH 自动替你在原会话回复；钉钉侧不会出现新的机器人，无需查找。'),
        error ? h('p', { style: style.err }, `无法连接本机服务：${error}`) : null,
        providers.map((p) => h(ProviderRow, { key: p.id, p, login: login && login.provider === p.id ? login : null })),
        h('p', { style: style.note }, '自检会新建一个会话并跑一轮真实 Agent 回合，只验证「引擎→会话→回复」链路，不发送任何 IM 消息。'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
          h('button', { style: style.button, onClick: runTest, disabled: testing }, testing ? '自检中…' : '运行自检（验证 Agent 链路）'),
          test ? h('p', { style: test.ok ? style.ok : style.err }, test.ok ? `✅ 自检通过（${test.elapsedMs}ms）：${test.reply || '（无回复文本）'}` : `❌ 自检失败：${test.error}`) : null,
        ),
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
