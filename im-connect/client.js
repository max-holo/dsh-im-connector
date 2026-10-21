window.__ModuleLoader__.load({
  id: '@local/im-connect',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    // 主题令牌（带兜底色）
    const C = {
      text: 'var(--dsw-alias-text-primary, #1f2329)',
      sub: 'var(--dsw-alias-text-secondary, #86909c)',
      border: 'var(--dsw-alias-border, #e5e6eb)',
      card: 'var(--dsw-alias-bg-container, #ffffff)',
      primary: '#1677ff',
      ok: '#389e0d',
      okBg: 'rgba(56,158,13,.10)',
      err: '#cf1322',
      errBg: 'rgba(207,19,34,.08)',
    };

    const s = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 0 8px', color: C.text, fontSize: 14, maxWidth: 720 },
      head: { display: 'flex', flexDirection: 'column', gap: 6 },
      title: { fontSize: 17, fontWeight: 700, margin: 0, letterSpacing: 0.2 },
      desc: { fontSize: 13, lineHeight: 1.6, color: C.sub, margin: 0 },
      card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      rowMain: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 260px' },
      rowSide: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
      dot: (ok) => ({ width: 8, height: 8, borderRadius: '50%', background: ok ? C.ok : C.err, boxShadow: `0 0 0 3px ${ok ? C.okBg : C.errBg}` }),
      name: { fontWeight: 600, fontSize: 14 },
      badge: (ok) => ({ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: ok ? C.okBg : C.errBg, color: ok ? C.ok : C.err, whiteSpace: 'nowrap' }),
      account: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 },
      // 开关（纯展示用 switch，点击整块可切换）
      switch: (on, busy) => ({
        position: 'relative', width: 44, height: 24, borderRadius: 999, cursor: busy ? 'wait' : 'pointer',
        background: on ? C.primary : '#c9cdd4', transition: 'background .18s ease', border: 'none', padding: 0, flexShrink: 0,
        opacity: busy ? 0.65 : 1,
      }),
      knob: (on) => ({
        position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .18s ease', boxShadow: '0 1px 2px rgba(0,0,0,.18)',
      }),
      btn: { padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap' },
      btnPrimary: { padding: '6px 14px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap' },
      input: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, width: 120, outline: 'none', lineHeight: '18px' },
      panel: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: `1px dashed ${C.border}`, marginTop: 2 },
      qr: { width: 220, height: 220, display: 'block', borderRadius: 10, background: '#fff' },
      hint: { fontSize: 12, color: C.sub, margin: 0, wordBreak: 'break-all', textAlign: 'center', lineHeight: 1.5 },
      err: { fontSize: 13, color: C.err, margin: 0 },
      okText: { fontSize: 13, color: C.ok, margin: 0 },
      empty: { fontSize: 13, color: C.sub, margin: 0, padding: '2px 0' },
      divider: { height: 1, background: C.border, opacity: 0.7, margin: '2px 0' },
      sectionTitle: { fontSize: 13, fontWeight: 600, color: C.sub, margin: 0, letterSpacing: 0.3 },
    };

    function Switch({ on, busy, onToggle, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'aria-label': label,
        style: s.switch(on, busy),
        onClick: () => onToggle(!on),
        title: on ? '点击关闭接收' : '点击开启接收',
      }, h('span', { style: s.knob(on) }));
    }

    function LoginPanel({ login, onClose, onRetry }) {
      if (!login) return null;
      if (login.state === 'waiting') {
        return h('div', { style: s.panel },
          login.url ? h('img', { style: s.qr, src: '/im-connect/api/qr.png?t=' + encodeURIComponent(login.startedAt || Date.now()), alt: '登录二维码' }) : h('p', { style: s.hint }, '正在生成二维码…'),
          h('p', { style: s.hint }, '用手机扫码完成授权'),
          login.url ? h('p', { style: s.hint }, '或打开链接：' + login.url) : null,
          h('button', { style: s.btn, onClick: onClose }, '取消'),
        );
      }
      if (login.state === 'authorized') {
        return h('div', { style: s.panel },
          h('p', { style: s.okText }, '✅ 授权完成，已连接'),
          h('button', { style: s.btn, onClick: onClose }, '关闭'),
        );
      }
      return h('div', { style: s.panel },
        h('p', { style: s.err }, login.error || '登录失败'),
        h('button', { style: s.btn, onClick: onRetry }, '重新登录'),
        h('button', { style: s.btn, onClick: onClose }, '关闭'),
      );
    }

    function ProviderCard({ p, login, onMountLogin, onCloseLogin }) {
      const [busy, setBusy] = useState(false);
      const [local, setLocal] = useState(p.receive);
      useEffect(() => { setLocal(p.receive); }, [p.receive]);

      const toggle = async (next) => {
        setLocal(next); // 立即反馈
        setBusy(true);
        try {
          await fetch('/im-connect/api/receive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: p.id, enabled: next }),
          });
          onMountLogin.refresh(); // 立即拉权威状态
        } finally {
          setBusy(false);
        }
      };
      const startLogin = () => {
        fetch('/im-connect/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: p.id }),
        }).catch(() => {});
        onMountLogin.startLogin(p.id);
      };

      return h('div', null,
        h('div', { style: s.row },
          h('div', { style: s.rowMain },
            h('span', { style: s.dot(p.connected) }),
            h('span', { style: s.name }, p.displayName),
            h('span', { style: s.badge(p.connected) }, p.connected ? '已连接' : '未连接'),
            p.account ? h('span', { style: s.account, title: p.account }, p.account) : null,
          ),
          h('div', { style: s.rowSide },
            h('span', { style: { fontSize: 12, color: C.sub } }, '接收'),
            h(Switch, { on: local, busy, onToggle: toggle, label: `${p.displayName} 接收开关` }),
            h('button', { style: s.btn, onClick: startLogin }, '扫码登录'),
          ),
        ),
        p.receiveHealth && !p.receiveHealth.ok
          ? h('p', { style: s.err }, '⚠️ 接收不可用：' + (p.receiveHealth.reason || '未知原因'))
          : null,
        h(LoginPanel, { login, onClose: onCloseLogin, onRetry: startLogin }),
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
      return h('div', { style: s.card },
        h('p', { style: s.sectionTitle }, `待批准私聊（${pending.length}）`),
        pending.map((p) => h('div', { key: p.provider + ':' + p.senderId, style: { ...s.row, paddingTop: 4 } },
          h('div', { style: s.rowMain },
            h('span', { style: s.name }, p.provider === 'dingtalk' ? '钉钉' : '企业微信'),
            h('span', { style: s.account, title: p.lastText }, (p.senderName || p.senderId) + '：' + p.lastText),
          ),
          h('div', { style: s.rowSide },
            h('button', { style: s.btnPrimary, onClick: () => decide(p, true) }, '批准'),
            h('button', { style: s.btn, onClick: () => decide(p, false) }, '拒绝'),
          ),
        )),
      );
    }

    function TriggersCard({ triggers, command, onChanged }) {
      const [prefix, setPrefix] = useState(command.prefix);
      const [busy, setBusy] = useState(false);
      useEffect(() => { setPrefix(command.prefix); }, [command.prefix]);

      const post = async (path, body) => {
        setBusy(true);
        try {
          await fetch('/im-connect/api/' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          onChanged();
        } finally {
          setBusy(false);
        }
      };

      return h('div', { style: s.card },
        h('p', { style: s.sectionTitle }, '触发方式'),
        // ① 群聊 @我 代答
        h('div', { style: s.row },
          h('div', { style: s.rowMain, flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
            h('span', { style: s.name }, '群聊 @我 代答'),
            h('span', { style: s.account }, '别人在群里 @你 时，AI 代你回复（公开可见）'),
          ),
          h('div', { style: s.rowSide }, h(Switch, {
            on: triggers.atMe,
            busy,
            onToggle: (next) => post('triggers', { atMe: next }),
            label: '群聊 @我 代答开关',
          })),
        ),
        h('div', { style: s.divider }),
        // ② 远程指令
        h('div', { style: s.row },
          h('div', { style: s.rowMain, flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
            h('span', { style: s.name }, '远程指令'),
            h('span', { style: s.account }, '私密群里 @自己 + 「前缀 指令」触发本机执行（仅你可见）'),
          ),
          h('div', { style: s.rowSide }, h(Switch, {
            on: command.enabled,
            busy,
            onToggle: (next) => post('command', { enabled: next }),
            label: '远程指令开关',
          })),
        ),
        h('div', { style: s.row },
          h('div', { style: s.rowMain },
            h('span', { style: s.account }, '指令前缀'),
            h('input', {
              style: s.input,
              value: prefix,
              onChange: (e) => setPrefix(e.target.value),
              placeholder: 'AI:',
              'aria-label': '指令前缀',
            }),
          ),
          h('div', { style: s.rowSide }, h('button', {
            style: s.btn,
            onClick: () => { if (prefix.trim()) post('command', { prefix: prefix.trim() }); },
            disabled: busy || !prefix.trim(),
          }, '保存')),
        ),
        h('p', { style: { fontSize: 12, color: C.sub, margin: 0 } },
          '示例：@自己 ' + (command.prefix || 'AI:') + ' 帮我看下今天的日程'),
      );
    }

    function ImConnectSettings() {
      const [state, setState] = useState({ providers: [], pending: [] });
      const [login, setLogin] = useState(null);
      const [error, setError] = useState(null);

      const refresh = useCallback(() => {
        fetch('/im-connect/api/state')
          .then((r) => r.json())
          .then((st) => { setError(null); setState(st); })
          .catch((e) => setError(String(e)));
      }, []);

      useEffect(() => {
        refresh();
        const t = setInterval(refresh, 30_000); // 状态兜底刷新（操作后立即刷新，不等轮询）
        return () => clearInterval(t);
      }, [refresh]);

      useEffect(() => {
        if (!login || login.state !== 'waiting') return undefined;
        const t = setInterval(() => {
          fetch('/im-connect/api/login-status')
            .then((r) => r.json())
            .then((st) => { setLogin(st); if (st.state !== 'waiting') refresh(); })
            .catch(() => {});
        }, 1500);
        return () => clearInterval(t);
      }, [login ? login.state : null, login ? login.provider : null, refresh]);

      const startLogin = (provider) => {
        setLogin({ state: 'waiting', provider, output: '', startedAt: Date.now(), url: null });
      };
      const closeLogin = () => setLogin(null);

      const mount = { refresh, startLogin };
      const providers = state.providers || [];

      return h('div', { style: s.wrap },
        h('div', { style: s.head },
          h('h3', { style: s.title }, 'IM 连接'),
          h('p', { style: s.desc }, '钉钉以你的账号代为回复：别人在群里 @你、或私聊你（批准后），DSH 会自动在原会话回复；钉钉侧不会出现新的机器人。'),
        ),
        error ? h('p', { style: s.err }, '无法连接本机服务：' + error) : null,
        h('div', { style: s.card },
          h('p', { style: s.sectionTitle }, '连接器'),
          h('div', { style: s.divider }),
          providers.length === 0
            ? h('p', { style: s.empty }, '加载中…')
            : providers.map((p) => h(ProviderCard, {
                key: p.id,
                p,
                login: login && login.provider === p.id ? login : null,
                onMountLogin: mount,
                onCloseLogin: closeLogin,
              })),
        ),
        state.command && state.triggers
          ? h(TriggersCard, { triggers: state.triggers, command: state.command, onChanged: refresh })
          : null,
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
