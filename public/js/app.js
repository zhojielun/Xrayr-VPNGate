const API = "/api";
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

const S = {
  view: "instances", instances: [], cronTasks: [], loading: false,
  creating: false,
  servers: [], serversLoading: false, serversCountry: "ALL",
  testResults: {}, testing: false,
  authenticated: false, username: "", checkingSession: true,
};

function toast(msg, type = "info") {
  let c = $(".toast-container");
  if (!c) { c = document.createElement("div"); c.className = "toast-container"; document.body.appendChild(c); }
  const t = document.createElement("div"); t.className = `toast toast-${type}`; t.textContent = msg;
  c.appendChild(t); setTimeout(() => t.remove(), 3500);
}

const I = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="18" r="1"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};

function svg(name, size = 14) {
  const d = document.createElement("div"); d.innerHTML = I[name] || "";
  const s = d.querySelector("svg"); if (s) { s.style.width = size + "px"; s.style.height = size + "px"; }
  return d.firstChild;
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  if (S.checkingSession || !S.authenticated) {
    app.className = "login-mode";
    if (S.checkingSession) {
      app.innerHTML = '<div class="login-root"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px;color:var(--muted)">检查会话...</p></div>';
    } else {
      app.appendChild(renderLoginPage());
    }
    return;
  }
  app.className = "";
  app.appendChild(renderSidebar());
  app.appendChild(renderWorkspace());
}

function renderLoginPage() {
  const page = document.createElement("div");
  page.className = "login-root";
  page.innerHTML = `
    <form class="login-card" id="login-form">
      <h2>VPN Gate Panel</h2>
      <p>登录管理面板</p>
      <label class="login-field"><span>用户名</span><input id="login-user" type="text" autocomplete="username" placeholder="admin" /></label>
      <label class="login-field"><span>密码</span><input id="login-pass" type="password" autocomplete="current-password" placeholder="密码" /></label>
      <button class="login-submit" type="submit" id="login-btn">登录</button>
      <div class="login-error" id="login-error"></div>
      <div class="login-hint">默认账号 admin / admin</div>
    </form>`;
  const form = page.querySelector("#login-form");
  const errDiv = page.querySelector("#login-error");
  const btn = page.querySelector("#login-btn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = "登录中...";
    errDiv.style.display = "none";
    const username = page.querySelector("#login-user").value.trim();
    const password = page.querySelector("#login-pass").value;
    const res = await api("POST", "/auth/login", { username, password });
    if (res.ok) {
      document.cookie = `session=${res.token}; path=/; max-age=${30*86400}`;
      S.authenticated = true; S.username = res.username;
      render();
      toast("登录成功", "success");
    } else {
      errDiv.textContent = res.error || "登录失败";
      errDiv.style.display = "block";
      btn.disabled = false; btn.textContent = "登录";
    }
  });
  return page;
}

function renderSidebar() {
  const sidebar = document.createElement("div"); sidebar.className = "sidebar";
  sidebar.innerHTML = `<div class="brand"><div class="brand-mark">${I.shield}</div><div><div class="brand-text">VPN Gate Panel</div><div class="brand-sub">可视化管理面板</div></div></div>`;
  const nav = document.createElement("div"); nav.className = "nav";
  [{ label: "管理" },
   { id: "instances", label: "VPN 实例", icon: "server" },
   { id: "cron", label: "定时任务", icon: "clock" },
   { id: "nodes", label: "节点测试", icon: "globe" },
   { id: "logs", label: "运行日志", icon: "file" },
  ].forEach(s => {
    if (!s.id) { const d = document.createElement("div"); d.className = "nav-label"; d.textContent = s.label; nav.appendChild(d); return; }
    const btn = document.createElement("button"); btn.className = `nav-item ${S.view === s.id ? "active" : ""}`;
    btn.onclick = () => { S.view = s.id; render(); };
    btn.appendChild(svg(s.icon)); btn.appendChild(document.createTextNode(s.label));
    nav.appendChild(btn);
  });
  sidebar.appendChild(nav);
  // Logout
  const logoutWrap = document.createElement("div");
  logoutWrap.style.cssText = "padding:12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px";
  const userLabel = document.createElement("div");
  userLabel.style.cssText = "color:var(--muted);font-size:11px;text-align:center";
  userLabel.textContent = `当前用户: ${S.username}`;
  logoutWrap.appendChild(userLabel);
  const pwBtn = document.createElement("button");
  pwBtn.className = "vp-outline-button";
  pwBtn.style.cssText = "width:100%;justify-content:center";
  pwBtn.textContent = "修改密码";
  pwBtn.addEventListener("click", () => showChangePasswordModal());
  logoutWrap.appendChild(pwBtn);
  const logoutBtn = document.createElement("button");
  logoutBtn.className = "vp-outline-button";
  logoutBtn.style.cssText = "width:100%;justify-content:center";
  logoutBtn.textContent = "退出登录";
  logoutBtn.addEventListener("click", async () => {
    await api("POST", "/auth/logout", {});
    document.cookie = "session=; path=/; max-age=0";
    S.authenticated = false; S.username = "";
    render();
  });
  logoutWrap.appendChild(logoutBtn);
  sidebar.appendChild(logoutWrap);
  return sidebar;
}

function renderWorkspace() {
  const ws = document.createElement("div"); ws.className = "workspace";
  const titles = { instances: "VPN 实例管理", cron: "定时任务管理", nodes: "节点测试", logs: "运行日志" };
  ws.innerHTML = `<div class="topbar"><h1>${titles[S.view]}</h1></div>`;
  const content = document.createElement("div"); content.className = "content";
  if (S.view === "instances") content.appendChild(renderInstances());
  else if (S.view === "cron") content.appendChild(renderCron());
  else if (S.view === "nodes") content.appendChild(renderNodes());
  else if (S.view === "logs") content.appendChild(renderLogs());
  ws.appendChild(content); return ws;
}

// ─── Dialog helpers (safe against render) ───────────────────────────────────

function closeDialog() { $$(".vp-dialog-backdrop").forEach(d => d.remove()); S.creating = false; }

function makeDialog(html) {
  closeDialog();
  const bd = document.createElement("div"); bd.className = "vp-dialog-backdrop";
  const dlg = document.createElement("div"); dlg.className = "vp-dialog"; dlg.style.cssText = "display:grid;gap:14px";
  dlg.innerHTML = html;
  bd.appendChild(dlg); document.body.appendChild(bd);
  // backdrop click — always works
  bd.addEventListener("click", e => { if (e.target === bd && !S.creating) closeDialog(); });
  // close button — always works (using addEventListener, not onclick assignment)
  dlg.querySelectorAll(".vp-close").forEach(b => b.addEventListener("click", () => { if (!S.creating) closeDialog(); }));
  return { bd, dlg };
}

function disableDialog(dlg, disabled) {
  S.creating = disabled;
  const btns = dlg.querySelectorAll("button");
  btns.forEach(b => {
    if (b.classList.contains("vp-close")) {
      b.disabled = disabled; b.style.opacity = disabled ? "0.5" : "1";
    }
  });
}

// ─── Instances ─────────────────────────────────────────────────────────────

function renderInstances() {
  const frag = document.createDocumentFragment();
  const toolbar = document.createElement("div"); toolbar.className = "vp-card vp-toolbar";
  toolbar.innerHTML = `<div><h2>VPN 实例</h2><p>管理 VPN Gate 实例，创建时自动对接 XrayR。</p></div>`;
  const actions = document.createElement("div"); actions.className = "vp-toolbar-actions";
  const refreshBtn = document.createElement("button"); refreshBtn.className = "vp-outline-button";
  refreshBtn.innerHTML = `${I.refresh} 刷新`;
  refreshBtn.onclick = async () => { refreshBtn.disabled = true; S.instances = await api("GET", "/instances"); refreshBtn.disabled = false; render(); toast("已刷新", "success"); };
  actions.appendChild(refreshBtn);
  const addBtn = document.createElement("button"); addBtn.className = "vp-primary-button";
  addBtn.innerHTML = `${I.plus} 新建实例`;
  addBtn.onclick = showCreateModal;
  actions.appendChild(addBtn);
  toolbar.appendChild(actions); frag.appendChild(toolbar);

  const summary = document.createElement("div"); summary.className = "vp-summary";
  const running = S.instances.filter(i => i.openvpn_running).length;
  [["实例总数", S.instances.length], ["运行中", running], ["已停止", S.instances.length - running], ["XrayR 对接", "—"]].forEach(([label, value]) => {
    const card = document.createElement("div"); card.className = "vp-summary-card";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    summary.appendChild(card);
  });
  frag.appendChild(summary);

  const listCard = document.createElement("div"); listCard.className = "vp-card vp-list-card";
  listCard.innerHTML = `<div class="vp-card-heading"><div><h2>实例列表</h2><p>查看和管理 VPN 实例。</p></div></div>`;

  if (!S.instances.length) {
    const empty = document.createElement("div"); empty.className = "vp-empty";
    empty.innerHTML = `<div class="vp-empty-icon">${I.server}</div><strong>暂无 VPN 实例</strong><p>点击右上角"新建实例"创建。</p>`;
    listCard.appendChild(empty);
  } else {
    const list = document.createElement("div"); list.className = "vp-list";
    S.instances.forEach(inst => {
      const row = document.createElement("div"); row.className = "vp-row";
      const main = document.createElement("div"); main.className = "vp-row-main";
      const modeLabel = {auto:"智能自动", fixed_country:"固定国家", fixed_ip:"固定IP"};
      const modeText = modeLabel[inst.route_mode] || "智能自动";
      const bestText = inst.best_node ? `${inst.best_node.ip} (${inst.best_node.country||""}) ${inst.best_node.latency_ms||"?"}ms` : "—";
      main.innerHTML = `
        <div class="vp-row-title"><span class="vp-row-icon">${I.server}</span><strong>${esc(inst.name || "实例 " + inst.id)}</strong><em class="tag-pill">${esc(inst.iface)}</em></div>
        <div class="vp-row-meta"><span>出口: ${esc(inst.exit_ip || "—")}</span><span>地区: ${esc(inst.country || "—")}</span><span>路由: ${esc(modeText)}</span><span>节点: ${esc(bestText)}</span></div>`;
      row.appendChild(main);
      const ra = document.createElement("div"); ra.className = "vp-row-actions";
      const pill = document.createElement("span"); pill.className = `status-pill ${inst.openvpn_running ? "running" : "stopped"}`;
      pill.textContent = inst.openvpn_running ? "运行中" : "未运行";
      ra.appendChild(pill);

      // Start button
      const startBtn = document.createElement("button"); startBtn.className = "vp-icon-button"; startBtn.title = "启动";
      startBtn.appendChild(svg("play", 14));
      startBtn.addEventListener("click", () => showStartModal(inst));
      ra.appendChild(startBtn);

      // Stop button
      const stopBtn = document.createElement("button"); stopBtn.className = "vp-icon-button"; stopBtn.title = "停止";
      stopBtn.appendChild(svg("square", 14));
      stopBtn.addEventListener("click", () => showConfirm(`确定停止 ${inst.name}？`, async () => {
        await api("POST", `/instances/${inst.id}/stop`); toast("已停止", "success");
        S.instances = await api("GET", "/instances"); render();
      }));
      ra.appendChild(stopBtn);

      // Refresh button
      const refBtn = document.createElement("button"); refBtn.className = "vp-icon-button"; refBtn.title = "心跳检测";
      refBtn.appendChild(svg("refresh", 14));
      refBtn.addEventListener("click", async () => {
        const res = await api("POST", `/instances/${inst.id}/refresh`);
        toast(res.ok ? "VPN 正常" : "VPN 失效", res.ok ? "success" : "error");
        S.instances = await api("GET", "/instances"); render();
      });
      ra.appendChild(refBtn);

      // Edit button
      const editBtn = document.createElement("button"); editBtn.className = "vp-icon-button"; editBtn.title = "编辑";
      editBtn.appendChild(svg("edit", 14));
      editBtn.addEventListener("click", () => showEditModal(inst));
      ra.appendChild(editBtn);

      // Scan nodes button
      const scanBtn = document.createElement("button"); scanBtn.className = "vp-icon-button"; scanBtn.title = "更新节点";
      scanBtn.appendChild(svg("zap", 14));
      scanBtn.addEventListener("click", () => showScanModal(inst));
      ra.appendChild(scanBtn);

      // Delete button
      const delBtn = document.createElement("button"); delBtn.className = "vp-icon-danger"; delBtn.title = "删除";
      delBtn.appendChild(svg("trash", 15));
      delBtn.addEventListener("click", () => showConfirm(`确定删除 ${inst.name}？此操作不可撤销。`, async () => {
        await api("DELETE", `/instances/${inst.id}`); toast("已删除", "success");
        S.instances = await api("GET", "/instances"); render();
      }));
      ra.appendChild(delBtn);
      row.appendChild(ra); list.appendChild(row);
    });
    listCard.appendChild(list);
  }
  frag.appendChild(listCard); return frag;
}

// ─── Create Modal (includes start logic) ───────────────────────────────────

function showCreateModal() {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>新建 VPN 实例</h2><p>创建实例并自动启动 VPN 连接、对接 XrayR</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>实例名称</span><input id="c-name" placeholder="例: 日本线路" autocomplete="off" /><small>用于标识此实例</small></label>
    <label class="vp-field"><span>选择地区</span><select id="c-country">${[["JP","日本"],["KR","韩国"],["US","美国"],["SG","新加坡"],["TW","台湾"],["HK","香港"],["DE","德国"],["FR","法国"],["CA","加拿大"],["AU","澳大利亚"],["NL","荷兰"],["GB","英国"],["IN","印度"],["RU","俄罗斯"],["ALL","全部地区"]].map(([c,n]) => `<option value="${c}">${n} (${c})</option>`).join("")}</select></label>
    <label class="vp-field"><span>XrayR 配置路径</span><input id="c-xrayr" value="/etc/XrayR/1.yml" autocomplete="off" /><small>XrayR YAML 配置文件路径，用于更新 SendIP</small></label>
    <div id="c-output" style="display:none"></div>
    <div class="vp-dialog-actions">
      <button class="vp-outline-button vp-close" type="button">取消</button>
      <button class="vp-primary-button" type="button" id="c-submit">创建并启动</button>
    </div>`);
  const submitBtn = dlg.querySelector("#c-submit");
  const out = dlg.querySelector("#c-output");
  submitBtn.addEventListener("click", async () => {
    const name = dlg.querySelector("#c-name").value.trim();
    if (!name) { toast("请输入实例名称", "error"); return; }
    disableDialog(dlg, true);
    submitBtn.textContent = "创建中...";
    out.style.display = "block";
    out.innerHTML = '<div class="log-viewer">正在创建实例...</div>';
    const inst = await api("POST", "/instances", {
      name, xrayr_config: dlg.querySelector("#c-xrayr").value || `/etc/XrayR/${(S.instances.length||0)+1}.yml`
    });
    out.innerHTML = '<div class="log-viewer">实例已创建，正在启动 VPN 并对接 XrayR...</div>';
    submitBtn.textContent = "连接中...";
    const country = dlg.querySelector("#c-country").value;
    const startRes = await api("POST", `/instances/${inst.id}/start`, { country });
    out.innerHTML = `<div class="log-viewer">${esc(startRes.output || "完成")}</div>`;
    submitBtn.textContent = "完成"; submitBtn.disabled = false;
    disableDialog(dlg, false);
    // change cancel to close
    dlg.querySelectorAll(".vp-close").forEach(b => { b.textContent = "关闭"; });
    toast(startRes.ok ? "创建成功" : "创建完成，VPN 可能未连接", startRes.ok ? "success" : "error");
    S.instances = await api("GET", "/instances"); render();
  });
}

// ─── Edit Modal ────────────────────────────────────────────────────────────

function showEditModal(inst) {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>编辑 ${esc(inst.name)}</h2><p>修改实例配置</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>实例名称</span><input id="e-name" value="${esc(inst.name||"")}" autocomplete="off" /></label>
    <label class="vp-field"><span>网卡</span><input id="e-iface" value="${esc(inst.iface||"")}" autocomplete="off" /><small>tun0, tun1, tun2...</small></label>
    <label class="vp-field"><span>路由表名</span><input id="e-rt" value="${esc(inst.route_table||"")}" autocomplete="off" /></label>
    <label class="vp-field"><span>路由表 ID</span><input id="e-rtid" type="number" value="${inst.route_table_id||100}" /></label>
    <label class="vp-field"><span>XrayR 配置路径</span><input id="e-xrayr" value="${esc(inst.xrayr_config||"")}" autocomplete="off" /></label>
    <div class="vp-dialog-actions"><button class="vp-outline-button vp-close" type="button">取消</button><button class="vp-primary-button" type="button" id="e-submit">保存</button></div>`);
  dlg.querySelector("#e-submit").addEventListener("click", async () => {
    await api("PUT", `/instances/${inst.id}`, {
      name: dlg.querySelector("#e-name").value,
      iface: dlg.querySelector("#e-iface").value,
      route_table: dlg.querySelector("#e-rt").value,
      route_table_id: parseInt(dlg.querySelector("#e-rtid").value) || 100,
      xrayr_config: dlg.querySelector("#e-xrayr").value,
    });
    closeDialog(); toast("已保存", "success");
    S.instances = await api("GET", "/instances"); render();
  });
}

function showStartModal(inst) {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>启动 ${esc(inst.name)}</h2><p>选择地区启动 VPN 连接，自动对接 XrayR</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>选择地区</span><select id="s-country">${[["","交互选择"],["JP","日本"],["KR","韩国"],["US","美国"],["SG","新加坡"],["TW","台湾"],["HK","香港"],["DE","德国"],["FR","法国"],["CA","加拿大"],["AU","澳大利亚"],["NL","荷兰"],["GB","英国"],["IN","印度"],["RU","俄罗斯"],["ALL","全部地区"]].map(([c,n])=>`<option value="${c}">${n}${c?" ("+c+")":""}</option>`).join("")}</select></label>
    <div id="s-output" style="display:none"></div>
    <div class="vp-dialog-actions"><button class="vp-outline-button vp-close" type="button">取消</button><button class="vp-primary-button" type="button" id="s-submit">启动</button></div>`);
  // pre-select last used country
  if (inst.country) {
    const sel = dlg.querySelector("#s-country");
    const opt = [...sel.options].find(o => o.value === inst.country);
    if (opt) sel.value = inst.country;
  }
  const submitBtn = dlg.querySelector("#s-submit");
  const out = dlg.querySelector("#s-output");
  submitBtn.addEventListener("click", async () => {
    disableDialog(dlg, true);
    submitBtn.textContent = "连接中...";
    out.style.display = "block";
    out.innerHTML = '<div class="log-viewer">正在启动 VPN 并对接 XrayR，请稍候...</div>';
    const country = dlg.querySelector("#s-country").value;
    const res = await api("POST", `/instances/${inst.id}/start`, { country: country || undefined });
    out.innerHTML = `<div class="log-viewer">${esc(res.output || "完成")}</div>`;
    submitBtn.textContent = "完成"; submitBtn.disabled = false;
    disableDialog(dlg, false);
    dlg.querySelectorAll(".vp-close").forEach(b => { b.textContent = "关闭"; });
    toast(res.ok ? "VPN 已连接" : "连接失败", res.ok ? "success" : "error");
    S.instances = await api("GET", "/instances"); render();
  });
}

function showScanModal(inst) {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>更新节点 - ${esc(inst.name)}</h2><p>并发测速扫描，自动筛选延迟最低的可达节点</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>出站路由模式</span><select id="sc-mode">
      <option value="auto" ${inst.route_mode==="auto"?"selected":""}>智能自动（推荐）</option>
      <option value="fixed_country" ${inst.route_mode==="fixed_country"?"selected":""}>固定国家地区</option>
      <option value="fixed_ip" ${inst.route_mode==="fixed_ip"?"selected":""}>固定 IP 节点</option>
    </select></label>
    <div id="sc-country-row" class="vp-field" style="display:${inst.route_mode==="fixed_country"?"grid":"none"}"><span>指定国家</span><select id="sc-country">${[["JP","日本"],["KR","韩国"],["US","美国"],["SG","新加坡"],["TW","台湾"],["HK","香港"],["DE","德国"],["FR","法国"],["CA","加拿大"],["AU","澳大利亚"],["NL","荷兰"],["GB","英国"],["IN","印度"],["RU","俄罗斯"]].map(([c,n])=>`<option value="${c}" ${inst.preferred_country===c?"selected":""}>${n} (${c})</option>`).join("")}</select></div>
    <div id="sc-ip-row" class="vp-field" style="display:${inst.route_mode==="fixed_ip"?"grid":"none"}"><span>指定 IP</span><input id="sc-ip" value="${esc(inst.preferred_ip||"")}" placeholder="如: 219.62.40.77" autocomplete="off" /></div>
    <div id="sc-output" style="display:none"></div>
    <div id="sc-results" style="display:none;max-height:300px;overflow-y:auto"></div>
    <div class="vp-dialog-actions">
      <button class="vp-outline-button vp-close" type="button">取消</button>
      <button class="vp-primary-button" type="button" id="sc-scan">开始扫描</button>
      <button class="vp-primary-button" type="button" id="sc-apply" style="display:none">应用最佳节点</button>
    </div>`);
  dlg.style.maxWidth = "700px";
  const modeSel = dlg.querySelector("#sc-mode");
  const countryRow = dlg.querySelector("#sc-country-row");
  const ipRow = dlg.querySelector("#sc-ip-row");
  const out = dlg.querySelector("#sc-output");
  const resultsDiv = dlg.querySelector("#sc-results");
  const scanBtn = dlg.querySelector("#sc-scan");
  const applyBtn = dlg.querySelector("#sc-apply");

  modeSel.addEventListener("change", () => {
    countryRow.style.display = modeSel.value === "fixed_country" ? "grid" : "none";
    ipRow.style.display = modeSel.value === "fixed_ip" ? "grid" : "none";
  });

  scanBtn.addEventListener("click", async () => {
    disableDialog(dlg, true);
    scanBtn.textContent = "扫描中...";
    out.style.display = "block";
    out.innerHTML = '<div class="log-viewer">正在并发扫描节点，请稍候...</div>';
    const country = modeSel.value === "fixed_country" ? dlg.querySelector("#sc-country").value : "ALL";
    const res = await api("POST", `/instances/${inst.id}/scan-nodes`, { country });
    if (res.ok && res.results) {
      const okCount = res.results.filter(r => r.tcp_ok).length;
      out.innerHTML = `<div class="log-viewer">扫描完成: ${res.results.length} 个节点, ${okCount} 个可达\n${res.results.slice(0,20).map(r => `${r.tcp_ok?"✓":"✗"} ${r.ip.padEnd(15)} ${r.country||""} ${r.latency_ms||""}ms ${r.proto||""}`).join("\n")}</div>`;
      // Auto pick best
      const pickRes = await api("POST", `/instances/${inst.id}/pick-node`, {
        route_mode: modeSel.value,
        preferred_country: dlg.querySelector("#sc-country")?.value || "",
        preferred_ip: dlg.querySelector("#sc-ip")?.value || "",
      });
      if (pickRes.ok && pickRes.node) {
        out.innerHTML += `\n\n最佳节点: ${pickRes.node.ip} (${pickRes.node.country||""}) ${pickRes.node.latency_ms||""}ms`;
      }
      applyBtn.style.display = "inline-flex";
    } else {
      out.innerHTML = `<div class="log-viewer">${esc(res.output || "扫描失败")}</div>`;
    }
    disableDialog(dlg, false);
    scanBtn.textContent = "重新扫描";
  });

  applyBtn.addEventListener("click", async () => {
    disableDialog(dlg, true);
    applyBtn.textContent = "应用中...";
    const pickRes = await api("POST", `/instances/${inst.id}/pick-node`, {
      route_mode: modeSel.value,
      preferred_country: dlg.querySelector("#sc-country")?.value || "",
      preferred_ip: dlg.querySelector("#sc-ip")?.value || "",
    });
    disableDialog(dlg, false);
    applyBtn.textContent = "应用最佳节点";
    dlg.querySelectorAll(".vp-close").forEach(b => { b.textContent = "关闭"; });
    toast(pickRes.ok ? "已应用最佳节点" : pickRes.output, pickRes.ok ? "success" : "error");
    S.instances = await api("GET", "/instances"); render();
  });
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────

function showConfirm(message, onConfirm) {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>确认操作</h2><p>${esc(message)}</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <div class="vp-dialog-actions"><button class="vp-outline-button vp-close" type="button">取消</button><button class="vp-danger-button" type="button" id="cfm-ok">确认</button></div>`);
  dlg.querySelector("#cfm-ok").addEventListener("click", async () => { closeDialog(); await onConfirm(); });
}

function showChangePasswordModal() {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>修改密码</h2><p>修改当前账户登录密码</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>用户名</span><input id="pw-user" value="${esc(S.username)}" autocomplete="username" /></label>
    <label class="vp-field"><span>当前密码</span><input id="pw-old" type="password" autocomplete="current-password" placeholder="当前密码" /></label>
    <label class="vp-field"><span>新密码</span><input id="pw-new" type="password" autocomplete="new-password" placeholder="新密码" /></label>
    <label class="vp-field"><span>确认新密码</span><input id="pw-confirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label>
    <div class="vp-dialog-actions"><button class="vp-outline-button vp-close" type="button">取消</button><button class="vp-primary-button" type="button" id="pw-submit">保存</button></div>`);
  dlg.querySelector("#pw-submit").addEventListener("click", async () => {
    const oldPw = dlg.querySelector("#pw-old").value;
    const newPw = dlg.querySelector("#pw-new").value;
    const confirm = dlg.querySelector("#pw-confirm").value;
    if (!oldPw || !newPw) { toast("请填写完整", "error"); return; }
    if (newPw !== confirm) { toast("两次密码不一致", "error"); return; }
    if (newPw.length < 4) { toast("密码至少4位", "error"); return; }
    const res = await api("POST", "/auth/change-password", {
      username: dlg.querySelector("#pw-user").value,
      old_password: oldPw, new_password: newPw,
    });
    if (res.ok) {
      closeDialog(); toast("密码已修改", "success");
    } else {
      toast(res.error || "修改失败", "error");
    }
  });
}

// ─── Cron ──────────────────────────────────────────────────────────────────

function renderCron() {
  const frag = document.createDocumentFragment();
  const toolbar = document.createElement("div"); toolbar.className = "vp-card vp-toolbar";
  toolbar.innerHTML = `<div><h2>定时任务</h2><p>管理 VPN 心跳检测定时任务。</p></div>`;
  const actions = document.createElement("div"); actions.className = "vp-toolbar-actions";
  const pvBtn = document.createElement("button"); pvBtn.className = "vp-outline-button"; pvBtn.textContent = "预览 Crontab";
  pvBtn.onclick = async () => { const r = await api("GET", "/cron-tasks/preview"); showLogModal("Crontab 预览", r.content || "(无)"); };
  actions.appendChild(pvBtn);
  const apBtn = document.createElement("button"); apBtn.className = "vp-outline-button"; apBtn.textContent = "应用到系统";
  apBtn.onclick = () => showConfirm("将覆盖系统 crontab 中的 VPN Gate 相关行，确定？", async () => {
    const r = await api("POST", "/cron-tasks/apply"); toast(r.ok ? "已应用" : "失败", r.ok ? "success" : "error");
  });
  actions.appendChild(apBtn);
  const addBtn = document.createElement("button"); addBtn.className = "vp-primary-button";
  addBtn.innerHTML = `${I.plus} 新建任务`; addBtn.onclick = showCronCreateModal;
  actions.appendChild(addBtn); toolbar.appendChild(actions); frag.appendChild(toolbar);

  const listCard = document.createElement("div"); listCard.className = "vp-card vp-list-card";
  listCard.innerHTML = `<div class="vp-card-heading"><div><h2>任务列表</h2><p>定时心跳检测任务。</p></div></div>`;
  if (!S.cronTasks.length) {
    const empty = document.createElement("div"); empty.className = "vp-empty";
    empty.innerHTML = `<div class="vp-empty-icon">${I.clock}</div><strong>暂无定时任务</strong><p>点击右上角"新建任务"创建。</p>`;
    listCard.appendChild(empty);
  } else {
    const list = document.createElement("div"); list.className = "vp-list";
    S.cronTasks.forEach(task => {
      const row = document.createElement("div"); row.className = "vp-row";
      const main = document.createElement("div"); main.className = "vp-row-main";
      main.innerHTML = `
        <div class="vp-row-title"><span class="vp-row-icon">${I.clock}</span><strong>实例 ${task.instance}</strong><em class="tag-pill" style="font-family:monospace">${esc(task.schedule)}</em></div>
        <div class="vp-row-meta"><span>${esc(task.description||"—")}</span><span>代理: ${esc(task.proxy||"直连")}</span></div>`;
      row.appendChild(main);
      const ra = document.createElement("div"); ra.className = "vp-row-actions";
      const lbl = document.createElement("label"); lbl.className = "toggle";
      const inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = !!task.enabled;
      inp.addEventListener("change", async () => { await api("PUT", `/cron-tasks/${task.id}`, { enabled: inp.checked }); S.cronTasks = await api("GET", "/cron-tasks"); });
      lbl.appendChild(inp); lbl.appendChild(Object.assign(document.createElement("span"), { className: "toggle-slider" }));
      ra.appendChild(lbl);
      const del = document.createElement("button"); del.className = "vp-icon-danger"; del.title = "删除";
      del.appendChild(svg("trash", 15));
      del.addEventListener("click", () => showConfirm("确定删除此定时任务？", async () => {
        await api("DELETE", `/cron-tasks/${task.id}`); toast("已删除", "success");
        S.cronTasks = await api("GET", "/cron-tasks"); render();
      }));
      ra.appendChild(del); row.appendChild(ra); list.appendChild(row);
    });
    listCard.appendChild(list);
  }
  frag.appendChild(listCard); return frag;
}

function showCronCreateModal() {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>新建定时任务</h2><p>创建定时心跳检测任务</p></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <label class="vp-field"><span>VPN 实例</span><select id="cr-inst">${S.instances.map(i=>`<option value="${i.id}">${esc(i.name||"实例 "+i.id)}</option>`).join("") || [1,2,3].map(i=>`<option value="${i}">实例 ${i}</option>`).join("")}</select></label>
    <label class="vp-field"><span>执行计划 (cron)</span><input id="cr-sched" value="*/10 * * * *" autocomplete="off" /></label>
    <div id="cr-presets" style="display:flex;gap:6px;flex-wrap:wrap">${[["*/1 * * * *","每1分钟"],["*/5 * * * *","每5分钟"],["*/10 * * * *","每10分钟"],["*/30 * * * *","每30分钟"],["0 */1 * * *","每小时"],["0 0 * * *","每天零点"]].map(([c,l])=>`<button class="vp-outline-button cr-preset" type="button" data-cron="${c}" style="height:28px;font-size:11px;padding:0 8px">${l}</button>`).join("")}</div>
    <label class="vp-field"><span>描述</span><input id="cr-desc" placeholder="例: 日本线路心跳" autocomplete="off" /></label>
    <div class="vp-dialog-actions"><button class="vp-outline-button vp-close" type="button">取消</button><button class="vp-primary-button" type="button" id="cr-submit">创建任务</button></div>`);
  // preset buttons
  dlg.querySelectorAll(".cr-preset").forEach(b => b.addEventListener("click", () => {
    dlg.querySelector("#cr-sched").value = b.dataset.cron;
  }));
  dlg.querySelector("#cr-submit").addEventListener("click", async () => {
    await api("POST", "/cron-tasks", {
      instance: parseInt(dlg.querySelector("#cr-inst").value),
      schedule: dlg.querySelector("#cr-sched").value.trim(),
      description: dlg.querySelector("#cr-desc").value.trim(),
    });
    closeDialog(); toast("任务已创建", "success");
    S.cronTasks = await api("GET", "/cron-tasks"); render();
  });
}

// ─── Nodes Test ────────────────────────────────────────────────────────────

async function loadAllNodes() {
  S.serversLoading = true; render();
  S.servers = await api("GET", "/servers?country=ALL");
  S.testResults = {};
  S.serversLoading = false; render();
  toast(`加载了 ${S.servers.length} 个节点`, "success");
}

function getFilteredServers() {
  if (S.serversCountry === "ALL") return S.servers;
  return S.servers.filter(s => s.country_code === S.serversCountry || s.country_code?.toUpperCase() === S.serversCountry);
}

function renderNodes() {
  const frag = document.createDocumentFragment();
  const toolbar = document.createElement("div"); toolbar.className = "vp-card vp-toolbar";
  toolbar.innerHTML = `<div><h2>节点测试</h2><p>测试 VPN Gate 节点可用性，按地区分类。</p></div>`;
  const actions = document.createElement("div"); actions.className = "vp-toolbar-actions";
  // dynamic country select
  const sel = document.createElement("select"); sel.className = "vp-select";
  const countries = {};
  S.servers.forEach(s => { const k = s.country_code || "??"; if (!countries[k]) countries[k] = s.country || k; });
  const sorted = Object.entries(countries).sort((a,b) => a[1].localeCompare(b[1]));
  sel.innerHTML = `<option value="ALL">全部地区 (ALL)</option>` + sorted.map(([code, name]) => `<option value="${code}" ${code===S.serversCountry?"selected":""}>${name} (${code})</option>`).join("");
  sel.addEventListener("change", () => { S.serversCountry = sel.value; render(); });
  actions.appendChild(sel);
  const loadBtn = document.createElement("button"); loadBtn.className = "vp-outline-button";
  loadBtn.innerHTML = `${I.refresh} 加载节点`;
  loadBtn.addEventListener("click", loadAllNodes);
  actions.appendChild(loadBtn);
  if (S.servers.length) {
    const testBtn = document.createElement("button"); testBtn.className = "vp-primary-button";
    testBtn.innerHTML = `${I.zap} 测试全部`; testBtn.disabled = S.testing;
    testBtn.addEventListener("click", testAllNodes);
    actions.appendChild(testBtn);
  }
  toolbar.appendChild(actions); frag.appendChild(toolbar);

  const filtered = getFilteredServers();
  if (S.servers.length) {
    const summary = document.createElement("div"); summary.className = "vp-summary";
    const tested = filtered.filter(s => S.testResults[s.ip]).length;
    const available = filtered.filter(s => S.testResults[s.ip]?.ok).length;
    [["节点总数", filtered.length], ["已测试", tested], ["可用", available], ["不可用", tested - available]].forEach(([l, v]) => {
      const c = document.createElement("div"); c.className = "vp-summary-card"; c.innerHTML = `<span>${l}</span><strong>${v}</strong>`; summary.appendChild(c);
    });
    frag.appendChild(summary);
  }

  const listCard = document.createElement("div"); listCard.className = "vp-card vp-list-card";
  listCard.innerHTML = `<div class="vp-card-heading"><div><h2>节点列表</h2><p>按地区分类显示。选择地区后立即筛选。</p></div></div>`;

  if (S.serversLoading) {
    const e = document.createElement("div"); e.className = "vp-empty"; e.innerHTML = `<span class="spinner"></span><strong>加载节点中...</strong>`;
    listCard.appendChild(e);
  } else if (!filtered.length) {
    const e = document.createElement("div"); e.className = "vp-empty";
    e.innerHTML = S.servers.length
      ? `<div class="vp-empty-icon">${I.globe}</div><strong>该地区暂无节点</strong><p>切换地区或点击"加载节点"刷新。</p>`
      : `<div class="vp-empty-icon">${I.globe}</div><strong>暂无节点</strong><p>点击"加载节点"获取 VPN Gate 服务器列表。</p>`;
    listCard.appendChild(e);
  } else {
    // group by country
    const groups = {};
    filtered.forEach(s => { const k = s.country||s.country_code||"未知"; if (!groups[k]) groups[k]=[]; groups[k].push(s); });
    Object.keys(groups).sort((a,b) => groups[b].length - groups[a].length).forEach(country => {
      const grp = document.createElement("div"); grp.className = "vp-country-group";
      grp.innerHTML = `<div class="vp-country-header">${esc(country)} <span class="count">(${groups[country].length})</span></div>`;
      const grid = document.createElement("div"); grid.className = "vp-node-grid";
      groups[country].forEach(s => {
        const row = document.createElement("div"); row.className = "vp-node-row";
        const tr = S.testResults[s.ip];
        const sh = tr ? (tr.ok ? '<span class="status-pill running">可用</span>' : '<span class="status-pill stopped">不可用</span>') : '<span class="tag-pill">未测试</span>';
        row.innerHTML = `<div><div class="vp-node-ip">${esc(s.ip)}</div><div class="vp-node-host">${esc(s.host)}</div></div><div class="vp-node-speed">${fmtSpd(s.speed)}</div><div class="vp-node-ping">${s.ping?s.ping+" ms":"—"}</div><div class="vp-node-proto">${s.proto}</div><div>${sh}</div><div style="text-align:right"><button class="vp-outline-button" style="height:28px;font-size:11px">测试</button></div>`;
        row.querySelector("button").addEventListener("click", async () => {
          row.querySelector("button").disabled = true; row.querySelector("button").textContent = "测试中...";
          try { const r = await fetch(`${API}/test-node?ip=${encodeURIComponent(s.ip)}&port=443`).then(r=>r.json()); S.testResults[s.ip] = r; } catch { S.testResults[s.ip] = {ok:false,message:"失败"}; }
          render();
        });
        grid.appendChild(row);
      });
      grp.appendChild(grid); listCard.appendChild(grp);
    });
  }
  frag.appendChild(listCard); return frag;
}

async function testAllNodes() {
  S.testing = true; render();
  for (const s of getFilteredServers()) {
    if (S.testResults[s.ip]) continue;
    try { const r = await fetch(`${API}/test-node?ip=${encodeURIComponent(s.ip)}&port=443`).then(r=>r.json()); S.testResults[s.ip] = r; }
    catch { S.testResults[s.ip] = {ok:false,message:"失败"}; }
  }
  S.testing = false; render(); toast("测试完成", "success");
}

function fmtSpd(bps) { if (!bps) return "—"; const m = bps/1e6; return m>=1 ? `${m.toFixed(0)} Mbps` : `${(bps/1e3).toFixed(0)} Kbps`; }

// ─── Logs ──────────────────────────────────────────────────────────────────

function renderLogs() {
  const frag = document.createDocumentFragment();
  const card = document.createElement("div"); card.className = "vp-card vp-list-card";
  card.innerHTML = `<div class="vp-card-heading"><div><h2>运行日志</h2><p>查看 VPN 实例运行日志。</p></div></div>`;
  const tb = document.createElement("div"); tb.className = "vp-toolbar-actions"; tb.style.marginBottom = "12px";
  const sel = document.createElement("select"); sel.className = "vp-select";
  if (S.instances.length) {
    S.instances.forEach(i => { const o=document.createElement("option"); o.value=i.id; o.textContent=esc(i.name||"实例 "+i.id); sel.appendChild(o); });
  } else {
    for (let i=1;i<=3;i++) { const o=document.createElement("option"); o.value=i; o.textContent=`实例 ${i}`; sel.appendChild(o); }
  }
  tb.appendChild(sel);
  const btn = document.createElement("button"); btn.className = "vp-primary-button";
  btn.innerHTML = `${I.refresh} 查看日志`;
  btn.addEventListener("click", async () => {
    const r = await api("GET", `/logs/${sel.value}`);
    viewer.textContent = r.content || "(日志为空)"; viewer.scrollTop = viewer.scrollHeight;
  });
  tb.appendChild(btn); card.appendChild(tb);
  const viewer = document.createElement("div"); viewer.className = "log-viewer"; viewer.style.minHeight = "200px";
  viewer.textContent = "选择实例后点击「查看日志」";
  card.appendChild(viewer); frag.appendChild(card); return frag;
}

function showLogModal(title, content) {
  const { bd, dlg } = makeDialog(`
    <div class="vp-dialog-header"><div><h2>${esc(title)}</h2></div><button class="vp-dialog-close vp-close" type="button">${I.x}</button></div>
    <div class="log-viewer" style="max-height:400px">${esc(content||"(无内容)")}</div>
    <div class="vp-dialog-actions" style="margin-top:14px"><button class="vp-outline-button vp-close" type="button">关闭</button></div>`);
  dlg.style.maxWidth = "700px";
}

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  S.checkingSession = true; render();
  try {
    const status = await api("GET", "/auth/status");
    if (status.ok) {
      S.authenticated = true; S.username = status.username;
      S.checkingSession = false; render();
      // Load data in parallel
      const [instances, cronTasks] = await Promise.all([
        api("GET", "/instances"), api("GET", "/cron-tasks"),
      ]);
      S.instances = instances; S.cronTasks = cronTasks;
      render();
      api("GET", "/servers?country=ALL").then(d => { S.servers = d; }).catch(() => {});
    } else {
      S.checkingSession = false; render();
    }
  } catch (e) {
    S.checkingSession = false; render();
  }
}
init();
