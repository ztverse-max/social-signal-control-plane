import { randomUUID } from "node:crypto";

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTimestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareEventsByPublishedAtDesc(left, right) {
  const publishedDelta =
    toTimestamp(right.message?.publishedAt) - toTimestamp(left.message?.publishedAt);

  if (publishedDelta !== 0) {
    return publishedDelta;
  }

  return toTimestamp(right.detectedAt) - toTimestamp(left.detectedAt);
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1));
}

function renderDashboardHtml(title) {
  const escapedTitle = escapeHtml(title);
  const styles = `
    :root{--bg:#060d18;--panel:#0d1625;--panel-2:#101d30;--line:rgba(125,158,198,.16);--text:#eef5ff;--muted:#90a3c2;--teal:#72e7da;--orange:#ff935f;--danger:#ff6b6b;--radius:18px;--sidebar:286px;--sidebar-mini:92px}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:var(--text);background:radial-gradient(circle at top left,rgba(255,147,95,.12),transparent 28%),radial-gradient(circle at 88% 8%,rgba(114,231,218,.1),transparent 24%),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(0deg,rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(180deg,#08101a,#040912);background-size:auto,auto,32px 32px,32px 32px,auto}body::before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(4,9,18,.08),rgba(4,9,18,.46))}
    a{color:inherit;text-decoration:none}button,input,select{font:inherit}button{cursor:pointer}
    .app{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);min-height:100vh;transition:grid-template-columns .2s ease}.app.collapsed{grid-template-columns:var(--sidebar-mini) minmax(0,1fr)}
    .sidebar{position:sticky;top:0;height:100vh;padding:18px;display:flex;flex-direction:column;gap:16px;border-right:1px solid var(--line);background:rgba(6,11,19,.96)}
    .brand,.nav a,.panel,.metric,.toast{border:1px solid var(--line);background:linear-gradient(180deg,rgba(13,22,37,.98),rgba(8,14,24,.94));box-shadow:0 18px 60px rgba(1,4,10,.35)}
    .brand,.panel,.metric{border-radius:var(--radius)}.brand{padding:16px;display:grid;gap:12px}.brand-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.mark,.toggle,.nav-icon{display:inline-flex;align-items:center;justify-content:center}
    .mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--teal),var(--orange));color:#07101a;font-weight:800}.toggle{width:44px;height:44px;border-radius:14px;border:1px solid rgba(114,231,218,.18);background:linear-gradient(180deg,#101b2a,#0a121e);color:var(--text);font-size:13px;font-weight:800;letter-spacing:.08em}
    .eyebrow{color:var(--teal);font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.brand-title{margin:4px 0 0;font-size:16px;font-weight:700}.brand-note,.muted,.empty,.pager-summary{color:var(--muted);font-size:13px;line-height:1.7}
    .nav{display:grid;gap:10px;flex:1}.nav a{display:grid;grid-template-columns:44px minmax(0,1fr);gap:14px;align-items:center;padding:14px 16px;border-radius:16px;background:transparent;border-color:transparent;color:var(--muted)}.nav a.active{background:linear-gradient(135deg,rgba(114,231,218,.14),rgba(255,147,95,.14));border-color:rgba(114,231,218,.22);color:var(--text)}.nav-icon{width:44px;height:44px;border-radius:14px;background:#0e1726;color:var(--teal);font-size:15px;font-weight:800}.nav-copy{display:grid;gap:3px;min-width:0}.nav-title,.nav-note{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nav-title{font-size:14px;font-weight:700}.nav-note{font-size:11px;line-height:1.4}
    .app.collapsed .brand-copy,.app.collapsed .nav-copy,.app.collapsed .side-note{display:none}.app.collapsed .nav a{grid-template-columns:1fr;justify-items:center;padding:12px 8px}.app.collapsed .nav-icon{width:48px;height:48px;font-size:15px}
    .main{padding:24px;display:grid;gap:18px}.top,.metrics,.page-grid,.grid-2,.grid-main,.feed,.form,.cards,.alerts,.timeline,.chart{display:grid;gap:14px}.top{grid-template-columns:minmax(0,1fr)}.top-card,.table-wrap{padding:22px 24px}.top-card{border-radius:var(--radius);border:1px solid var(--line);background:linear-gradient(180deg,rgba(11,18,31,.98),rgba(9,15,26,.94))}
    .top h1{margin:0;font-size:clamp(28px,4vw,40px);line-height:1.06}.status,.badge,.btn,.tab,.chip,.pager{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:14px;border:1px solid var(--line);min-height:40px;padding:10px 14px}
    .metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.metric{padding:18px;overflow:hidden}.metric-label{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.metric-value{margin-top:12px;font-size:clamp(28px,3vw,38px);font-weight:800;line-height:1}.metric-foot{margin-top:10px;color:var(--muted);font-size:12px;line-height:1.65}
    .page-grid,.grid-main{align-items:start}.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-main{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)}.panel{padding:18px}.panel-head,.signal-head,.signal-foot,.list-item,.mini-head,.pagination{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.panel-head{margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid rgba(125,158,198,.12)}.panel h2,.panel h3{margin:0 0 4px;font-size:18px}
    .tabs,.chips,.toolbar,.mini-actions,.pager-group{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.btn,.tab,.chip,.pager{background:#0f1929;color:var(--text)}.btn.primary{background:linear-gradient(135deg,var(--teal),var(--orange));border-color:transparent;color:#07101a;font-weight:800}.tab.active,.chip.active,.pager.active{background:linear-gradient(135deg,rgba(114,231,218,.16),rgba(255,147,95,.16));border-color:rgba(114,231,218,.26)}.btn.link{border:none;background:transparent;color:var(--teal);padding:0;min-height:auto}.btn[disabled],.pager[disabled]{opacity:.42;cursor:not-allowed}
    .field{display:grid;gap:8px}.field span{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.field input,.field select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#08101b;color:var(--text)}.field-checkbox{grid-template-columns:auto 1fr;align-items:center}.field-checkbox input{width:auto;margin:0}.field-checkbox span{text-transform:none;letter-spacing:0}
    .alerts{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.alert{padding:16px;border:1px solid var(--line);border-radius:16px;background:#0d1726}.alert.danger{border-color:rgba(255,107,107,.2);background:rgba(39,13,17,.96)}.alert-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:15px;font-weight:700}.status{min-height:auto;padding:8px 12px;background:rgba(114,231,218,.12);color:var(--teal);font-size:12px;font-weight:700}.status.danger{background:rgba(255,107,107,.12);color:#ffb6b6}.chart-row{display:grid;grid-template-columns:120px minmax(0,1fr) 56px;gap:10px;align-items:center}.chart-track{position:relative;height:10px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}.chart-bar{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--teal),var(--orange))}
    table{width:100%;border-collapse:collapse;min-width:560px}th,td{padding:12px 10px;border-bottom:1px solid rgba(125,158,198,.1);text-align:left;font-size:13px;vertical-align:top}th{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.timeline{position:relative;padding-left:18px}.timeline::before{content:"";position:absolute;top:6px;bottom:6px;left:5px;width:1px;background:linear-gradient(180deg,rgba(114,231,218,.6),rgba(255,147,95,.16))}.timeline-item{position:relative;display:grid;gap:4px;padding-left:12px}.timeline-item::before{content:"";position:absolute;top:6px;left:-18px;width:10px;height:10px;border-radius:999px;background:var(--teal)}
    .signal{display:grid;gap:14px}.signal-link{transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}.signal-link:hover{transform:translateY(-1px);border-color:rgba(114,231,218,.28);box-shadow:0 22px 64px rgba(1,4,10,.45)}.signal-head{align-items:flex-start}.signal-body{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:16px;align-items:start}.signal-no-media .signal-body{grid-template-columns:minmax(0,1fr)}.signal-main{display:grid;gap:10px;min-width:0}.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:12px}.badge{min-height:auto;padding:8px 12px;background:rgba(255,147,95,.12);color:#ffd7c3}.signal-title{margin:0;font-size:16px;line-height:1.4;font-weight:700}.signal-summary{margin:0;color:#d5def2;font-size:12px;line-height:1.8;white-space:pre-wrap;word-break:break-word}.thumbs{display:flex;justify-content:flex-end}.thumb{position:relative;display:block;width:96px;height:72px;flex:0 0 auto;border-radius:12px;border:1px solid var(--line);overflow:hidden;background:linear-gradient(180deg,#07111d,#0b1624)}.thumb img{display:block;width:100%;height:100%;object-fit:contain;padding:4px;background:#07111d}.thumb-badge{position:absolute;right:6px;bottom:6px;padding:3px 6px;border-radius:999px;background:rgba(5,10,18,.88);font-size:9px;font-weight:700;letter-spacing:.06em}
    .signal-foot{padding-top:12px;border-top:1px solid rgba(125,158,198,.12);color:var(--muted);font-size:12px;line-height:1.7}.mini{padding:16px;border:1px solid var(--line);border-radius:16px;background:#0d1726}.item-list{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:10px}.list-item{padding:14px;border:1px solid rgba(125,158,198,.12);border-radius:16px;background:#09111d}.empty{padding:22px;border:1px dashed var(--line);border-radius:16px;background:#08101b;text-align:center}.pagination{padding-top:12px;border-top:1px solid rgba(125,158,198,.12)}.page[hidden]{display:none}
    .toast{position:fixed;right:18px;bottom:18px;z-index:20;min-width:240px;max-width:min(92vw,420px);padding:14px 16px;border-radius:14px;color:var(--text)}.toast[data-type="error"]{background:rgba(39,13,17,.96);border-color:rgba(255,107,107,.16)}
    @media (max-width:1200px){.metrics,.grid-2,.grid-main,.top{grid-template-columns:1fr}}@media (max-width:920px){.app,.app.collapsed{grid-template-columns:1fr}.sidebar{position:static;height:auto}.app.collapsed .brand-copy,.app.collapsed .nav-copy,.app.collapsed .side-note{display:initial}.app.collapsed .nav a{grid-template-columns:38px minmax(0,1fr);justify-items:stretch;padding-inline:14px}.signal-body{grid-template-columns:minmax(0,1fr) 96px}}@media (max-width:720px){.main{padding:16px}.panel-head,.signal-head,.signal-foot,.pagination,.list-item,.mini-head{flex-direction:column;align-items:flex-start}.signal-body,.signal-no-media .signal-body{grid-template-columns:1fr}.thumbs{justify-content:flex-start}.tab,.chip,.pager{flex:1 1 100%}}
  `;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapedTitle}</title><style>${styles}</style></head><body><main id="app-shell" class="app"><aside class="sidebar"><section class="brand"><div class="brand-row"><span class="mark">AI</span><button id="nav-toggle" class="toggle" type="button" aria-label="收起菜单">收</button></div><div class="brand-copy"><div class="eyebrow">AI Intelligence Dashboard</div><p class="brand-title">${escapedTitle}</p><p class="brand-note">高信息密度工作台，消息展示与设置操作分离，所有功能按独立页面组织。</p></div></section><nav id="sidebar-nav" class="nav"></nav><section class="brand side-note"><strong>实时分发</strong><div class="muted">发现新消息后，SSE、浏览器通知和通知渠道会立即触发。</div></section></aside><section class="main"><header class="top"><article class="top-card"><div class="eyebrow">Signal Control Plane</div><h1 id="page-title">情报总览</h1><p id="page-description" class="muted">以图表、表格、告警和时间线查看监控系统状态。</p></article></header><section class="metrics"><article class="metric"><div class="metric-label">监控平台</div><div id="stat-platforms" class="metric-value">0</div><div class="metric-foot">当前可管理的平台数量</div></article><article class="metric"><div class="metric-label">监控用户</div><div id="stat-targets" class="metric-value">0</div><div class="metric-foot">当前配置中的全部目标</div></article><article class="metric"><div class="metric-label">缓存消息</div><div id="stat-messages" class="metric-value">0</div><div class="metric-foot">当前前端缓存的消息条数</div></article><article class="metric"><div class="metric-label">当前结果</div><div id="stat-results" class="metric-value">0</div><div class="metric-foot">当前页面可见的结果数量</div></article></section><section id="page-dashboard" class="page page-grid"><article class="panel"><div class="panel-head"><div><h2>告警中心</h2><div class="muted">登录失效、无目标和待配置项集中显示。</div></div></div><div id="dashboard-alerts" class="alerts"><div class="empty">正在生成系统告警...</div></div></article><div class="grid-2"><article class="panel"><div class="panel-head"><div><h2>平台分布图</h2><div class="muted">按平台统计缓存消息数量。</div></div></div><div id="dashboard-platform-chart" class="chart"><div class="empty">暂无图表数据</div></div></article><article class="panel"><div class="panel-head"><div><h2>最新时间线</h2><div class="muted">按发布时间倒序显示最新消息。</div></div></div><div id="dashboard-timeline" class="timeline"><div class="empty">暂无时间线数据</div></div></article></div><article class="panel"><div class="panel-head"><div><h2>监控目标表</h2><div class="muted">按目标聚合平台、消息数和最近发布时间。</div></div></div><div class="table-wrap"><table><thead><tr><th>监控目标</th><th>平台</th><th>消息数</th><th>最近发布时间</th><th>状态</th></tr></thead><tbody id="dashboard-target-table-body"><tr><td colspan="5" class="empty">暂无监控目标数据</td></tr></tbody></table></div></article></section><section id="page-feed" class="page page-grid" hidden><div class="grid-2"><article class="panel"><div class="panel-head"><div><h2>平台分页</h2><div class="muted">按平台切换消息源。</div></div><button id="clear-filters" class="btn" type="button">清空筛选</button></div><div id="platform-tabs" class="tabs loading">正在加载平台...</div></article><article class="panel"><div class="panel-head"><div><h2>监控用户筛选</h2><div id="filter-help" class="muted">按当前平台目标进行筛选。</div></div></div><div id="target-filters" class="chips loading">正在加载监控用户...</div></article></div><article class="panel"><div class="panel-head"><div><h2>实时消息流</h2><div id="result-summary" class="muted">按发布时间倒序展示。</div></div><div class="toolbar"><label class="page-size" for="page-size">每页显示<select id="page-size"><option value="6">6</option><option value="12" selected>12</option><option value="24">24</option></select></label></div></div><section id="stream" class="feed"><div class="empty">正在加载消息...</div></section><div id="pagination" class="pagination"></div></article></section><section id="page-targets" class="page page-grid" hidden><div class="grid-main"><article class="panel"><div class="panel-head"><div><h2>新增或编辑监控用户</h2><div class="muted">每个平台的监控目标都可以在这里独立维护。</div></div></div><form id="monitor-form" class="form"><label class="field"><span>监控平台</span><select id="monitor-platform"></select></label><div id="monitor-fields" class="cards"></div><div class="mini-actions"><button class="btn primary" type="submit"><span id="target-submit-text">添加监控用户</span></button><button id="target-cancel" class="btn" type="button" hidden>取消编辑</button></div></form></article><article class="panel"><div class="panel-head"><div><h2>已配置监控用户</h2><div class="muted">默认目标已移除，仅展示当前实际配置目标。</div></div></div><div id="managed-targets" class="cards"><div class="empty">正在加载监控用户...</div></div></article></div></section><section id="page-auth" class="page page-grid" hidden><article class="panel"><div class="panel-head"><div><h2>平台登录状态</h2><div class="muted">需要登录的平台会显示状态、登录入口和失效提醒。</div></div></div><div id="auth-grid" class="grid-2"><div class="empty">正在加载登录状态...</div></div></article></section><section id="page-channels" class="page page-grid" hidden><div class="grid-main"><article class="panel"><div class="panel-head"><div><h2>接入通知渠道</h2><div class="muted">支持新增或编辑 Webhook、Telegram 等通知模块。</div></div></div><form id="channel-form" class="form"><label class="field"><span>渠道类型</span><select id="channel-type"><option value="webhook">Webhook</option><option value="telegram">Telegram</option></select></label><div id="channel-fields" class="cards"></div><div class="mini-actions"><button class="btn primary" type="submit"><span id="channel-submit-text">接入通知渠道</span></button><button id="channel-cancel" class="btn" type="button" hidden>取消编辑</button></div></form></article><article class="panel"><div class="panel-head"><div><h2>已接入通知渠道</h2><div class="muted">内置渠道保留，外部渠道支持编辑和删除。</div></div></div><div id="managed-channels" class="cards"><div class="empty">正在加载通知渠道...</div></div><div class="panel-head" style="margin-top:18px"><div><h2>已发现会话 ID</h2><div class="muted">让目标用户或群先与智能机器人交互一次，这里会自动记录 userid 或 chatid。</div></div><button id="refresh-discovered-sessions" class="btn" type="button">刷新列表</button></div><div id="discovered-sessions" class="cards"><div class="empty">暂未发现企业微信智能机器人会话。</div></div></article></div></section><section id="page-notifications" class="page page-grid" hidden><article class="panel"><div class="panel-head"><div><h2>浏览器通知</h2><div class="muted">检测到新消息后，浏览器可直接弹出系统通知。</div></div></div><article class="alert"><div class="alert-title"><span>通知权限状态</span><span class="status">BROWSER</span></div><p id="browser-notification-status" class="muted">正在检查浏览器通知权限...</p><div class="mini-actions"><button id="enable-browser-notification" class="btn primary" type="button">启用浏览器通知</button></div></article></article></section></section></main><div id="toast" class="toast" hidden></div><script type="module" src="/dashboard.js"></script></body></html>`;
}

export class RealtimeHub {
  constructor({ maxRecent = 100, webPushManager } = {}) {
    this.maxRecent = maxRecent;
    this.webPushManager = webPushManager;
    this.clients = new Map();
    this.recent = [];
    this.catalog = [];
  }

  #upsertCatalogEntry({ platformId, platformName, targetId, targetLabel }) {
    if (!platformId || !targetId) {
      return;
    }

    let platform = this.catalog.find((entry) => entry.platformId === platformId);

    if (!platform) {
      platform = {
        platformId,
        platformName: platformName ?? platformId,
        targets: []
      };
      this.catalog.push(platform);
    } else if (platformName) {
      platform.platformName = platformName;
    }

    if (!platform.targets.some((target) => target.id === targetId)) {
      platform.targets.push({
        id: targetId,
        label: targetLabel ?? targetId
      });
    }
  }

  setCatalog(entries = []) {
    this.catalog = [];

    for (const entry of entries) {
      this.#upsertCatalogEntry(entry);
    }
  }

  getCatalog() {
    return {
      platforms: this.catalog.map((platform) => ({
        platformId: platform.platformId,
        platformName: platform.platformName,
        targets: platform.targets.map((target) => ({
          id: target.id,
          label: target.label
        }))
      }))
    };
  }

  publish(event) {
    this.#upsertCatalogEntry({
      platformId: event.platformId,
      platformName: event.platformName,
      targetId: event.target?.id,
      targetLabel: event.target?.label
    });

    this.recent = [...this.recent, event]
      .sort(compareEventsByPublishedAtDesc)
      .slice(0, this.maxRecent);

    const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;

    for (const response of this.clients.values()) {
      response.write(payload);
    }

    if (this.webPushManager) {
      void this.webPushManager.notify(event);
    }
  }

  getRecent() {
    return [...this.recent];
  }

  queryRecent({ platformId, targetIds, page = 1, pageSize = this.maxRecent } = {}) {
    const targetIdSet = new Set(targetIds ?? []);
    const filtered = this.recent.filter((event) => {
      const matchPlatform = !platformId || event.platformId === platformId;
      const matchTarget = targetIdSet.size === 0 || targetIdSet.has(event.target?.id);
      return matchPlatform && matchTarget;
    });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = clampPage(page, totalPages);
    const startIndex = (safePage - 1) * pageSize;

    return {
      items: filtered.slice(startIndex, startIndex + pageSize),
      total,
      page: safePage,
      pageSize,
      totalPages
    };
  }

  attachServerSentEvents(request, response) {
    const clientId = randomUUID();

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    response.write("retry: 3000\n\n");
    this.clients.set(clientId, response);

    request.on("close", () => {
      this.clients.delete(clientId);
    });
  }

  renderDashboard(title = "消息聚合控制台") {
    return renderDashboardHtml(title);
  }
}
