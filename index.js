'use strict';

const { Telegraf, Markup } = require('telegraf');
const mongoose             = require('mongoose');
const Anthropic            = require('@anthropic-ai/sdk');
const http                 = require('http');

const BOT_TOKEN         = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI         = process.env.MONGO_URI  || '';
const SUPPORT_PHONE     = process.env.SUPPORT_PHONE     || '0960336138';
const ADMIN_IDS         = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY || '';
const AI_AUTO_APPROVE   = (process.env.AI_AUTO_APPROVE  || 'true') === 'true';
const TARGET_KG_DEFAULT = Number(process.env.TARGET_KG_DEFAULT) || 5000;
const CHANNEL_ID        = (process.env.CHANNEL_ID || '').trim();
const REG_PER_KG        = 10;
const SHIP_PER_KG       = 25;

if (!BOT_TOKEN || !MONGO_URI) { console.error('❌ BOT_TOKEN እና MONGO_URI ያስፈልጋሉ'); process.exit(1); }

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

const ROUTES = [
  { id: 'finotselam',   emoji: '🟢', label: 'አዲስ አበባ → ፍኖተሰላም',   targetKg: TARGET_KG_DEFAULT },
  { id: 'debre_markos', emoji: '🔵', label: 'አዲስ አበባ → ደብረ ማርቆስ', targetKg: TARGET_KG_DEFAULT },
  { id: 'mota',         emoji: '🟤', label: 'አዲስ አበባ → ሞጣ',         targetKg: TARGET_KG_DEFAULT },
  { id: 'bahirdar',     emoji: '🔵', label: 'አዲስ አበባ → ባህር ዳር',     targetKg: TARGET_KG_DEFAULT },
  { id: 'gondar',       emoji: '🟣', label: 'አዲስ አበባ → ጎንደር',       targetKg: TARGET_KG_DEFAULT },
  { id: 'debre_berhan', emoji: '🟡', label: 'አዲስ አበባ → ደብረ ብርሃን',  targetKg: TARGET_KG_DEFAULT },
  { id: 'kemissie',     emoji: '🟠', label: 'አዲስ አበባ → ከሚሴ',        targetKg: TARGET_KG_DEFAULT },
  { id: 'dessie',       emoji: '🔴', label: 'አዲስ አበባ → ደሴ',         targetKg: TARGET_KG_DEFAULT },
];

const METHODS = [
  { id: 'telebirr', emoji: '📱', label: 'ቴሌብር',   info: process.env.TELEBIRR_INFO || 'Telebirr: 0960336138' },
  { id: 'cbe',      emoji: '🏦', label: 'CBE ባንክ', info: process.env.CBE_INFO      || 'CBE: 1000370308447'  },
];

const byRoute  = id => ROUTES.find(r => r.id === id);
const byMethod = id => METHODS.find(m => m.id === id);
const ACTIVE   = ['pending', 'reviewing', 'approved'];

// ── DB ──
const Reg = mongoose.model('Reg', new mongoose.Schema({
  userId:         { type: Number, required: true },
  username:       { type: String, default: '' },
  fullName:       String,
  phone:          String,
  routeId:        String,
  cargoDesc:      String,
  weightKg:       { type: Number, default: 0 },
  totalPrice:     { type: Number, default: 0 },
  paymentMethod:  { type: String, default: null },
  paymentFileId:  { type: String, default: null },
  locationLat:    { type: Number, default: null },
  locationLng:    { type: Number, default: null },
  status:         { type: String, default: 'pending', enum: ['pending','reviewing','approved','rejected','sent'] },
  aiVerdict:      { type: mongoose.Schema.Types.Mixed, default: null },
  aiAutoApproved: { type: Boolean, default: false },
  createdAt:      { type: Date, default: Date.now },
}));

const Session = mongoose.model('Session', new mongoose.Schema({
  key:       { type: String, unique: true },
  data:      { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 * 3 } },
}));

const RouteCap = mongoose.model('RouteCap', new mongoose.Schema({
  routeId:  { type: String, unique: true },
  notified: { type: Boolean, default: false },
}));

// ── SESSION ──
async function getSession(key) {
  try { const d = await Session.findOne({ key }).lean(); return d?.data || {}; } catch { return {}; }
}
async function saveSession(key, data) {
  try { await Session.findOneAndUpdate({ key }, { data, updatedAt: new Date() }, { upsert: true }); } catch {}
}
function sessionMW(ctx, next) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`;
  return getSession(key).then(data => { ctx.session = data; return next().then(() => saveSession(key, ctx.session)); });
}

// ── RATE LIMIT ──
const rateLimitMap = new Map();
function isRateLimited(userId, limit = 20) {
  const now = Date.now();
  const e = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 60_000; }
  e.count++;
  rateLimitMap.set(userId, e);
  return e.count > limit;
}
setInterval(() => { const now = Date.now(); for (const [k,v] of rateLimitMap) if (now > v.reset) rateLimitMap.delete(k); }, 5*60_000);

// ── HELPERS ──
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);

const ST = {
  pending:   '⏳ ክፍያ ይጠብቃል',
  reviewing: '🔍 እየተፈተሸ ነው',
  approved:  '✅ ተፈቅዷል',
  rejected:  '❌ አልተቀበለም',
  sent:      '🚚 ተልኳል',
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId);
  const me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `👤 ${r.fullName} | 📞 ${r.phone}\n` +
    `📦 ${r.cargoDesc} — ${r.weightKg}ኪሎ\n` +
    `💳 ${me?.label || '—'} | ` +
    `📍 ${r.locationLat ? `[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : 'አልተላከም'}\n` +
    `${ST[r.status]}`;
  if (r.aiAutoApproved) t += ' 🤖';
  if (admin) t += `\n\`${r.userId}\`${r.username ? ' @'+r.username : ''}`;
  return t;
}

function capLine(total, target) {
  const pct    = Math.max(0, Math.min(100, Math.round((total/target)*100)));
  const filled = Math.round(pct/10);
  const remain = Math.max(0, target - total);
  return (
    '█'.repeat(filled) + '░'.repeat(10-filled) + ' ' + pct + '%\n' +
    'የተመዘገበ: ' + total + ' ኪሎ\n' +
    'ቀሪ: ' + remain + ' ኪሎ\n' +
    'ኢላማ: ' + target + ' ኪሎ'
  );
}

function esc(t) { return String(t||'—').replace(/[_*[\]()~`>#+=|{}.!-]/g, c => '\\'+c); }

const mainKb = () => Markup.keyboard([
  ...ROUTES.map(r => [`${r.emoji} ${r.label}`]),
  ['📋 ምዝገባዬ', '📊 ቆጣሪ'],
  ...(ADMIN_IDS.length ? [['🔧 Admin']] : []),
]).resize();

const locKb = () => Markup.keyboard([
  [Markup.button.locationRequest('📍 አድራሻዬን ላክ')],
  ['⏭️ ሳላጋራ ጨርስ'],
]).resize().oneTime();

const approveKb = id => Markup.inlineKeyboard([[
  Markup.button.callback('✅ ፈቀድ',  `ok_${id}`),
  Markup.button.callback('❌ ከልክል', `no_${id}`),
]]);

// ── CAPACITY ──
async function routeWeight(routeId) {
  const res = await Reg.aggregate([
    { $match: { routeId, status: { $in: ACTIVE } } },
    { $group: { _id: null, total: { $sum: '$weightKg' } } },
  ]);
  return res[0]?.total || 0;
}

async function checkCapacity(routeId) {
  const ro = byRoute(routeId);
  if (!ro) return;
  const total = await routeWeight(routeId);
  let cap = await RouteCap.findOne({ routeId });
  if (!cap) cap = await RouteCap.create({ routeId, notified: false });

  if (total >= ro.targetKg && !cap.notified) {
    cap.notified = true;
    await cap.save();
    const members = await Reg.find({ routeId, status: { $in: ACTIVE } }).lean();
    for (const m of members) {
      bot.telegram.sendMessage(m.userId,
        `✅ *${ro.label}* — ጭነቱ ሞልቷል!\n\nሠራተኞቻችን ቤትዎ ይሰበስቡዎታል — ዝግጁ ይሁኑ.\n${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    for (const aid of ADMIN_IDS)
      bot.telegram.sendMessage(aid, `${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ | ${members.length} ሰው`).catch(() => {});
    if (CHANNEL_ID)
      bot.telegram.sendMessage(CHANNEL_ID,
        `📢 *${ro.label}*\n${capLine(total, ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

// ── AI ──
async function checkPayment(fileId, reg) {
  if (!anthropic) return null;
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const res  = await fetch(link.href || String(link));
    if (!res.ok) throw new Error('fetch fail');
    const b64  = Buffer.from(await res.arrayBuffer()).toString('base64');
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const m    = byMethod(reg.paymentMethod);
    const msg  = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text:
          `Payment screenshot. Method:${m?.label} Account:"${m?.info}" Amount:${reg.totalPrice}ETB\n` +
          `Reply ONLY JSON: {"amount_match":true/false,"account_match":true/false,"looks_edited":true/false,"confidence":"high|medium|low","reason":"short amharic"}` },
      ]}],
    });
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) { console.error('AI:', e.message); return null; }
}

const aiOk = r => r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === 'high';
const aiSummary = r => !r ? '🤖 ማረጋገጫ አልተሳካም'
  : `🤖 ${aiOk(r) ? '✅' : r?.looks_edited ? '⚠️' : '❌'} (${r.confidence}) ${r.reason||''}`;

// ── PRINT ──
const PRINT_STATUS = {
  approved: 'ፈቃድ ያላቸው',
  reviewing: 'እየተፈተሸ',
  pending: 'ያልከፈሉ',
  sent: 'ተልኳል',
};

function buildManifestHTML(ro, list) {
  const totalKg   = list.reduce((s,r) => s+(r.weightKg||0), 0);
  const totalReg  = totalKg * REG_PER_KG;
  const totalShip = totalKg * SHIP_PER_KG;
  const cnt = { approved:0, reviewing:0, pending:0, sent:0 };
  list.forEach(r => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
  const date = new Date().toLocaleDateString('en-GB');

  // approved first, then reviewing, pending, sent
  const ORDER = ['approved','reviewing','pending','sent'];
  const sorted = [...list].sort((a,b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  const rows = sorted.map((r, i) => {
    const statusAm = PRINT_STATUS[r.status] || r.status;
    const mapUrl   = r.locationLat
      ? `<a href="https://maps.google.com/?q=${r.locationLat},${r.locationLng}">ካርታ</a>`
      : '—';
    const bg = r.status === 'approved' ? '#e8f5e9'
             : r.status === 'reviewing' ? '#fff8e1'
             : r.status === 'sent'      ? '#e3f2fd'
             : '#fff';
    return `<tr style="background:${bg}">
      <td>${i+1}</td>
      <td>${r.fullName || '—'}</td>
      <td>${r.phone || '—'}</td>
      <td>${r.cargoDesc || '—'}</td>
      <td style="text-align:center"><b>${r.weightKg || 0}</b></td>
      <td style="text-align:center">${(r.weightKg||0)*REG_PER_KG}</td>
      <td style="text-align:center">${(r.weightKg||0)*SHIP_PER_KG}</td>
      <td style="text-align:center">${statusAm}</td>
      <td style="text-align:center">${mapUrl}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ro.label} — ዝርዝር</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans Ethiopic', 'Segoe UI', sans-serif; font-size: 13px; padding: 16px; color: #111; }
  h2 { font-size: 16px; margin-bottom: 4px; }
  .meta { color: #555; margin-bottom: 14px; font-size: 12px; }
  .summary { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .box { border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; min-width: 110px; text-align: center; background: #fafafa; }
  .box .val { font-size: 20px; font-weight: bold; }
  .box .lbl { font-size: 11px; color: #666; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { background: #263238; color: #fff; padding: 7px 6px; text-align: left; font-size: 12px; }
  td { padding: 6px 6px; border-bottom: 1px solid #e0e0e0; vertical-align: middle; }
  tr:hover { filter: brightness(0.97); }
  a { color: #1565c0; text-decoration: none; }
  .legend { margin-top: 14px; font-size: 11px; display: flex; gap: 14px; flex-wrap: wrap; }
  .dot { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  #printBtn { margin-top: 16px; padding: 10px 28px; font-size: 14px; background: #263238; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  @media print {
    #printBtn { display: none; }
    body { padding: 0; font-size: 11px; }
    .box { padding: 5px 10px; }
    th { font-size: 11px; }
    td { padding: 4px 5px; font-size: 11px; }
  }
</style>
</head>
<body>
<h2>${ro.label} — የጭነት ዝርዝር</h2>
<div class="meta">📅 ${date} &nbsp;|&nbsp; 👥 ${list.length} ሰው &nbsp;|&nbsp; ⚖️ ${totalKg} ኪሎ</div>

<div class="summary">
  <div class="box"><div class="val">${list.length}</div><div class="lbl">ጠቅላላ ሰው</div></div>
  <div class="box"><div class="val">${totalKg}</div><div class="lbl">ጠቅላላ ኪሎ</div></div>
  <div class="box" style="background:#e8f5e9"><div class="val">${cnt.approved}</div><div class="lbl">✅ ፈቃድ ያላቸው</div></div>
  <div class="box" style="background:#fff8e1"><div class="val">${cnt.reviewing}</div><div class="lbl">🔍 እየተፈተሸ</div></div>
  <div class="box" style="background:#fff"><div class="val">${cnt.pending}</div><div class="lbl">⏳ ያልከፈሉ</div></div>
  <div class="box" style="background:#e3f2fd"><div class="val">${cnt.sent}</div><div class="lbl">🚚 ተልኳል</div></div>
  <div class="box"><div class="val">${totalReg.toLocaleString('en')}</div><div class="lbl">ምዝ ብር (${REG_PER_KG}×ኪ)</div></div>
  <div class="box"><div class="val">${totalShip.toLocaleString('en')}</div><div class="lbl">ጭ ብር (${SHIP_PER_KG}×ኪ)</div></div>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>ሙሉ ስም</th>
      <th>ስልክ</th>
      <th>ጭነት ዓይነት</th>
      <th style="text-align:center">ኪሎ</th>
      <th style="text-align:center">ምዝ ብር</th>
      <th style="text-align:center">ጭ ብር</th>
      <th style="text-align:center">ሁኔታ</th>
      <th style="text-align:center">አድራሻ</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<div class="legend">
  <span><span class="dot" style="background:#e8f5e9;border:1px solid #aaa"></span>ፈቃድ ያላቸው</span>
  <span><span class="dot" style="background:#fff8e1;border:1px solid #aaa"></span>እየተፈተሸ</span>
  <span><span class="dot" style="background:#fff;border:1px solid #aaa"></span>ያልከፈሉ</span>
  <span><span class="dot" style="background:#e3f2fd;border:1px solid #aaa"></span>ተልኳል</span>
</div>

<button id="printBtn" onclick="window.print()">🖨️ ፕሪንት</button>
</body>
</html>`;
}

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) { await ctx.reply('መስመር አልተገኘም'); return; }
  try {
    const list = await Reg.find({ routeId, status: { $ne: 'rejected' } }).sort({ createdAt: 1 }).lean();
    if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);

    const totalKg = list.reduce((s,r) => s+(r.weightKg||0), 0);
    const html    = buildManifestHTML(ro, list);

    await ctx.replyWithDocument(
      { source: Buffer.from(html, 'utf-8'), filename: `${ro.id}_manifest.html` },
      {
        caption:
          `🖨️ *${ro.label}*\n` +
          `👥 ${list.length} ሰው | ⚖️ ${totalKg} ኪሎ\n\n` +
          `ፋይሉን ክፈቱ → "🖨️ ፕሪንት" ይጫኑ`,
        parse_mode: 'Markdown',
      }
    );
  } catch(e) { await ctx.reply(`ስህተት: ${e.message}`); }
}

// ── DAILY REPORT ──
async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;
  let txt = `📊 ዕለታዊ ሪፖርት — ${new Date().toLocaleDateString('am-ET')}\n\n`;
  let gKg = 0, gPeople = 0, gPending = 0;
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([{ $match:{ routeId:ro.id } }, { $group:{ _id:'$status', n:{$sum:1}, kg:{$sum:'$weightKg'} } }]);
    const m = {}; counts.forEach(c => { m[c._id] = { n:c.n, kg:c.kg }; });
    const people = counts.reduce((s,c) => s+c.n, 0);
    const kg = (m.pending?.kg||0)+(m.reviewing?.kg||0)+(m.approved?.kg||0)+(m.sent?.kg||0);
    gKg += kg; gPeople += people; gPending += (m.pending?.n||0)+(m.reviewing?.n||0);
    if (!people) continue;
    txt += `${ro.emoji} ${ro.label}\n${people} ሰው | ${kg}ኪሎ | ✅${m.approved?.n||0} 🔍${m.reviewing?.n||0} ⏳${m.pending?.n||0} 🚚${m.sent?.n||0}\n\n`;
  }
  txt += `ጠቅላላ: ${gPeople} ሰው | ${gKg}ኪሎ | ያልተፈቀዱ: ${gPending}\nምዝ: ${(gKg*REG_PER_KG).toLocaleString('en')}ብ | ጭ: ${(gKg*SHIP_PER_KG).toLocaleString('en')}ብ`;
  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, txt).catch(() => {});
  console.log('📊 Daily report sent');
}

function startDailyReportScheduler() {
  let last = '';
  setInterval(async () => {
    const eat  = new Date(Date.now() + 3*60*60*1000);
    const date = eat.toISOString().slice(0,10);
    if (eat.getUTCHours() === 7 && eat.getUTCMinutes() === 0 && last !== date) {
      last = date;
      await sendDailyReport().catch(e => console.error('Daily report:', e.message));
    }
  }, 60_000);
}

// ── BOT ──
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);
bot.use(async (ctx, next) => {
  if (ctx.from?.id && !isAdmin(ctx) && isRateLimited(ctx.from.id))
    return ctx.reply('ብዙ ጥያቄ — ትንሽ ይጠብቁ').catch(() => {});
  return next();
});
bot.catch((err, ctx) => console.error('Bot error:', err?.message, ctx?.updateType));

// /start
bot.start(async ctx => {
  ctx.session = {};
  await ctx.reply(
    '*የጋራ ጭነት አገልግሎት* 🚛\n' +
    'ከአዲስ አበባ ወደ አማራ ክልል\n\n' +
    'ምዝገባ ክፍያ: *10ብር/ኪሎ* (አሁን)\n' +
    'የጭነት ክፍያ: *25ብር/ኪሎ* (ሲሰበሰብ)\n' +
    'ቤትዎ ድረስ እንሰበስባለን 🏠\n\n' +
    'መስመር ይምረጡ 👇',
    { parse_mode:'Markdown', ...mainKb() }
  );
});

// ቆጣሪ
bot.hears('📊 ቆጣሪ', async ctx => {
  ctx.session = {};
  let txt = '*የጭነት ሁኔታ*\n\n';
  for (const ro of ROUTES) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\n${capLine(total, ro.targetKg)}\n\n`;
  }
  await ctx.reply(txt, { parse_mode:'Markdown', ...mainKb() });
});

// ምዝገባዬ
bot.hears('📋 ምዝገባዬ', async ctx => {
  ctx.session = {};
  const list = await Reg.find({ userId:ctx.from.id, status:{ $nin:['rejected'] } }).sort({ createdAt:-1 }).lean();
  if (!list.length) return ctx.reply('ምዝገባ የለዎትም። 👇 መስመር ይምረጡ', mainKb());
  for (const r of list) {
    const btns = [];
    if (r.status !== 'sent') btns.push(Markup.button.callback('🗑️ ሰርዝ', `del_${r._id}`));
    if (!r.locationLat && r.status !== 'sent') btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode:'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}) });
  }
});

// አድራሻ ጨምር
bot.action(/^addloc_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step:'LOC', locRegId:String(r._id), locTries:0 };
  await ctx.reply('አድራሻዎን ያጋሩ 👇', locKb());
});

// መስመሮች
ROUTES.forEach(route => {
  bot.hears(`${route.emoji} ${route.label}`, async ctx => {
    const ex = await Reg.findOne({ userId:ctx.from.id, routeId:route.id, status:{ $nin:['rejected','sent'] } }).lean();
    if (ex) {
      const btns = [Markup.button.callback('🗑️ ሰርዝ', `del_${ex._id}`)];
      if (!ex.locationLat) btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${ex._id}`));
      btns.push(Markup.button.callback('➕ ሌላ እቃ', `more_${route.id}`));
      return ctx.reply(card(ex)+'\n\n_ቀደም ሲል ተመዝግበዋል_', { parse_mode:'Markdown', ...Markup.inlineKeyboard([btns]) });
    }
    ctx.session = { step:'NAME', routeId:route.id, d:{} };
    await ctx.reply(`${route.emoji} ${route.label}\n\nስምዎን ያስገቡ:`, { parse_mode:'Markdown', ...mainKb() });
  });
});

bot.action(/^more_([a-z_]+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  ctx.session = { step:'NAME', routeId:route.id, d:{} };
  await ctx.reply(`${route.emoji} ${route.label} — ➕ ሌላ እቃ\n\nስምዎን ያስገቡ:`, { parse_mode:'Markdown', ...mainKb() });
});

// ክፍያ method
bot.action(/^pm_(.+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'PAYMETHOD') return;
  const m = byMethod(ctx.match[1]);
  if (!m) return;
  const { d, routeId } = ctx.session;
  ctx.session = {};
  const r = await Reg.create({
    userId:ctx.from.id, username:ctx.from.username||'',
    fullName:d.name, phone:d.phone, routeId,
    cargoDesc:d.cargo, weightKg:d.kg,
    totalPrice:d.kg*REG_PER_KG, paymentMethod:m.id, status:'pending',
  });
  await checkCapacity(routeId);
  await ctx.editMessageReplyMarkup({ inline_keyboard:[] }).catch(() => {});
  const acct = m.info.includes(':') ? m.info.split(':').slice(1).join(':').trim() : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\nቁጥር: \`${acct}\`\n\n*${r.totalPrice} ብር* ይክፈሉ — ከዚያ ደረሰኝ ፎቶ ይላኩ 📸`,
    { parse_mode:'Markdown', ...mainKb() }
  );
});

// TEXT flow
bot.on('text', async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();
  const reserved = ['📋 ምዝገባዬ','📊 ቆጣሪ','🔧 Admin','⏭️ ሳላጋራ ጨርስ',...ROUTES.map(r=>`${r.emoji} ${r.label}`)];
  if (reserved.includes(txt)) return next();

  if (step === 'PAYMETHOD') return ctx.reply('👆 ከቁልፍ ይምረጡ');
  if (step === 'NAME') {
    if (txt.length < 3) return ctx.reply('ሙሉ ስም ያስገቡ (3+ ፊደል)');
    ctx.session.d.name = txt; ctx.session.step = 'PHONE';
    return ctx.reply('ስልክ ቁጥር:', { parse_mode:'Markdown' });
  }
  if (step === 'PHONE') {
    const phone = txt.replace(/\s/g,'');
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply('ትክክለኛ ስልክ ያስገቡ (ለምሳሌ: 0912345678)');
    ctx.session.d.phone = phone; ctx.session.step = 'CARGO';
    return ctx.reply('ጭነት ዓይነት:');
  }
  if (step === 'CARGO') {
    ctx.session.d.cargo = txt; ctx.session.step = 'WEIGHT';
    return ctx.reply('ክብደት (ኪሎ):');
  }
  if (step === 'WEIGHT') {
    const kg = parseFloat(txt.replace(/[^0-9.]/g,''));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply('ትክክለኛ ቁጥር (1–2000)');
    ctx.session.d.kg = kg; ctx.session.step = 'PAYMETHOD';
    return ctx.reply(
      `*${ctx.session.d.name}* | ${ctx.session.d.cargo} — ${kg}ኪሎ\nምዝ ክፍያ: *${kg*REG_PER_KG}ብር* | ጭ ክፍያ: ${kg*SHIP_PER_KG}ብር (ሲሰበሰብ)\n\nክፍያ መንገድ:`,
      { parse_mode:'Markdown', ...Markup.inlineKeyboard(METHODS.map(m=>[Markup.button.callback(`${m.emoji} ${m.label}`,`pm_${m.id}`)]))  }
    );
  }
  if (step === 'LOC') {
    ctx.session.locTries = (ctx.session.locTries||0)+1;
    if (ctx.session.locTries >= 3) return ctx.reply(`👇 ቁልፉን ይጫኑ | ${SUPPORT_PHONE}`, locKb());
    return ctx.reply('👇 ቁልፉን ይጫኑ', locKb());
  }
  if (step === 'SEND_NOTE') {
    if (!isAdmin(ctx)) { ctx.session = {}; return next(); }
    const ro = byRoute(ctx.session.sendRoute);
    ctx.session = {};
    const ready = await Reg.find({ routeId:ro?.id, status:'approved' }).lean();
    if (!ready.length) return ctx.reply('ፈቃድ ያለው ምዝገባ የለም', mainKb());
    await Reg.updateMany({ _id:{ $in:ready.map(r=>r._id) } }, { status:'sent' });
    let sent = 0;
    for (const r of ready) {
      try {
        await bot.telegram.sendMessage(r.userId,
          `🚚 ጭነትዎ ተልኳል!\n${byRoute(r.routeId)?.label}\n\n${txt}\n\n${SUPPORT_PHONE}`,
          { parse_mode:'Markdown' });
        sent++;
      } catch {}
    }
    return ctx.reply(`✅ ተልኳል — ${ready.length} ሰው (${sent} ደርሷቸዋል)`, mainKb());
  }
  return next();
});

// LOCATION
bot.on('location', async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude:lat, longitude:lng } = ctx.message.location;

  if (step === 'COL_LOC' && isAdmin(ctx)) {
    const ro = byRoute(ctx.session.colRoute);
    ctx.session = {};
    const list = await Reg.find({ routeId:ro?.id, status:{ $in:ACTIVE } }).lean();
    if (!list.length) return ctx.reply(`${ro?.label} — ምዝገባ የለም`, mainKb());
    function km(a1,o1,a2,o2) {
      const R=6371,da=(a2-a1)*Math.PI/180,dl=(o2-o1)*Math.PI/180;
      const x=Math.sin(da/2)**2+Math.cos(a1*Math.PI/180)*Math.cos(a2*Math.PI/180)*Math.sin(dl/2)**2;
      return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
    }
    const sorted = list.map(r=>({...r,dist:r.locationLat?km(lat,lng,r.locationLat,r.locationLng):9999})).sort((a,b)=>a.dist-b.dist);
    await ctx.reply(`${ro?.label} — ${sorted.length} ሰው`);
    for (let i=0;i<sorted.length;i++) {
      const r = sorted[i];
      await ctx.reply(`${i+1}. ${r.fullName} | ${r.phone} | ${r.weightKg}ኪ | ${r.dist<9999?r.dist.toFixed(1)+'ኪሜ':'—'}`, { parse_mode:'Markdown' });
      if (r.locationLat) await bot.telegram.sendLocation(ctx.chat.id,r.locationLat,r.locationLng).catch(()=>{});
    }
    return;
  }

  if (step === 'LOC') {
    const regId = ctx.session.locRegId;
    ctx.session = {};
    const r = await Reg.findByIdAndUpdate(regId, { locationLat:lat, locationLng:lng }, { new:true });
    if (!r) return ctx.reply('ምዝገባ አልተገኘም', mainKb());
    const total = await routeWeight(r.routeId);
    const ro2   = byRoute(r.routeId);
    await ctx.reply(
      `✅ ምዝገባ ተጠናቀቀ!\n\n${ro2?.label}\n${capLine(total, ro2?.targetKg||TARGET_KG_DEFAULT)}\n\nጭነቱ ሲሞላ ቤትዎ ይሰበሰብዎታል 🏠\n${SUPPORT_PHONE}`,
      { parse_mode:'Markdown', ...mainKb() }
    );
    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid,`📍 ${r.fullName} (${r.phone}) → ${ro2?.label}`).catch(()=>{});
      bot.telegram.sendLocation(aid,lat,lng).catch(()=>{});
    }
    return;
  }
  return next();
});

bot.hears('⏭️ ሳላጋራ ጨርስ', async ctx => {
  if (ctx.session?.step !== 'LOC') return ctx.reply('👇 መስመር ይምረጡ', mainKb());
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply(`✅ ምዝገባ ተጠናቀቀ!\n\nአድራሻ ኋላ ለማጨምር: "📋 ምዝገባዬ" → "📍 አድራሻ ላክ"\n${SUPPORT_PHONE}`, mainKb());
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r) for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid,`⚠️ አድራሻ አልተላከም — ${r.fullName} (${r.phone})`).catch(()=>{});
  }
});

// PHOTO
bot.on('photo', async ctx => {
  const r = await Reg.findOne({ userId:ctx.from.id, status:'pending' }).sort({ createdAt:-1 });
  if (!r) return ctx.reply('ምዝገባ አልተገኘም። 👇 መስመር ይምረጡ', mainKb());
  const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;
  r.paymentFileId = fileId; r.status = 'reviewing';
  await r.save();
  await ctx.reply('ፎቶ ደርሷል — ክፍያ እየተረጋገጠ ነው...');
  const verdict = await checkPayment(fileId, r);
  r.aiVerdict   = verdict;
  const autoOk  = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) { r.status = 'approved'; r.aiAutoApproved = true; }
  await r.save();
  bot.telegram.sendMessage(ctx.from.id,
    autoOk
      ? `✅ ክፍያ ተፈቅዷል!\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል. ${SUPPORT_PHONE}`
      : `ፎቶ ደርሷል. ክፍያ እየተፈተሸ ነው — ትንሽ ይጠብቁ. ${SUPPORT_PHONE}`,
    { parse_mode:'Markdown' }
  ).catch(()=>{});
  ctx.session = { step:'LOC', locRegId:String(r._id), locTries:0 };
  await ctx.reply('አድራሻዎን ያጋሩ — ቤትዎ ይሰበሰብዎታል 👇', locKb());
  const caption = aiSummary(verdict)+'\n\n'+(autoOk?'✅ AI ያረጋገጠ\n\n':'')+card(r.toObject(),true);
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk?'↩️ ሰርዝ':'✅ ፈቀድ', autoOk?`no_${r._id}`:`ok_${r._id}`),
    Markup.button.callback('❌ ከልክል',`no_${r._id}`),
  ]]);
  for (const aid of ADMIN_IDS) bot.telegram.sendPhoto(aid,fileId,{ caption, parse_mode:'Markdown', ...kb }).catch(()=>{});
});

// Admin
bot.hears('🔧 Admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔');
  ctx.session = {};
  await ctx.reply('Admin', { parse_mode:'Markdown', ...Markup.inlineKeyboard([
    ...ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`,`lst_${r.id}`)]),
    [Markup.button.callback('🔍 ያልተፈቀዱ','lst_pay')],
    [Markup.button.callback('🗺️ ሰብሳቢ','col_pick')],
    [Markup.button.callback('🚚 ላክ','snd_pick')],
    [Markup.button.callback('📊 ሪፖርት','report')],
    [Markup.button.callback('📢 ቻናል','channel_panel')],
    [Markup.button.callback('🖨️ ፕሪንት','print_pick')],
  ]) });
});

bot.action(/^lst_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const list = await Reg.find({ routeId:ro.id }).sort({ createdAt:-1 }).lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);
  const cnt = {}; list.forEach(r=>{ cnt[r.status]=(cnt[r.status]||0)+1; });
  const total = await routeWeight(ro.id);
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n${list.length} ሰው | ✅${cnt.approved||0} 🔍${cnt.reviewing||0} ⏳${cnt.pending||0} 🚚${cnt.sent||0}\n${capLine(total,ro.targetKg)}`,
    { parse_mode:'Markdown' }
  );
  for (const r of list) {
    const kb = r.status==='reviewing' ? approveKb(r._id)
      : r.status==='approved' ? Markup.inlineKeyboard([[Markup.button.callback('❌ ሰርዝ',`no_${r._id}`)]])
      : {};
    await ctx.reply(card(r,true), { parse_mode:'Markdown', ...kb });
  }
});

bot.action('lst_pay', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  const list = await Reg.find({ status:'reviewing' }).sort({ createdAt:1 }).lean();
  if (!list.length) return ctx.reply('ያልተፈቀደ ክፍያ የለም');
  for (const r of list) {
    const txt = aiSummary(r.aiVerdict)+'\n\n'+card(r,true);
    if (r.paymentFileId) await bot.telegram.sendPhoto(ctx.chat.id,r.paymentFileId,{ caption:txt, parse_mode:'Markdown', ...approveKb(r._id) });
    else await ctx.reply(txt, { parse_mode:'Markdown', ...approveKb(r._id) });
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status:newStatus }, { new:true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx[fn](card(r.toObject(),true), { parse_mode:'Markdown' }).catch(()=>{});
  if (notifyFn) bot.telegram.sendMessage(r.userId, notifyFn(r), { parse_mode:'Markdown' }).catch(()=>{});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery('✅').catch(()=>{});
  await setStatus(ctx, ctx.match[1], 'approved', r =>
    `✅ ክፍያ ተፈቅዷል!\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል. ${SUPPORT_PHONE}`
  );
});

bot.action(/^no_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery('❌').catch(()=>{});
  await setStatus(ctx, ctx.match[1], 'rejected', () =>
    `❌ ክፍያ አልተቀበለም. ${SUPPORT_PHONE}`
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(()=>{});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === 'sent') return ctx.reply('ጭነቱ ተልኳል — መሰረዝ አይቻልም');
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard:[] }).catch(()=>{});
  await checkCapacity(routeId);
  await ctx.reply('ምዝገባ ተሰርዟል. 👇 ለመመዝገብ መስመር ይምረጡ', mainKb());
});

bot.action('snd_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  await ctx.reply('ምን መስመር?', Markup.inlineKeyboard(ROUTES.map(r=>[Markup.button.callback(`${r.emoji} ${r.label}`,`snd_${r.id}`)])));
});

bot.action(/^snd_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  const ro    = byRoute(ctx.match[1]);
  const ready = await Reg.find({ routeId:ro?.id, status:'approved' }).lean();
  if (!ready.length) return ctx.reply('ፈቃድ ያለው ምዝገባ የለም');
  const total = ready.reduce((s,r)=>s+(r.weightKg||0),0);
  ctx.session = { step:'SEND_NOTE', sendRoute:ro?.id };
  await ctx.reply(`${ro?.label} | ${ready.length} ሰው | ${total}ኪሎ\n\nለደንበኞች ማስታወሻ ያስገቡ:`, { parse_mode:'Markdown' });
});

bot.action('report', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  let txt = '*ሪፖርት*\n\n';
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([{ $match:{ routeId:ro.id } },{ $group:{ _id:'$status', n:{ $sum:1 } } }]);
    const m = {}; counts.forEach(c=>{ m[c._id]=c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\n✅${m.approved||0} 🔍${m.reviewing||0} ⏳${m.pending||0} 🚚${m.sent||0} | ${total}/${ro.targetKg}ኪ\n\n`;
  }
  await ctx.reply(txt, { parse_mode:'Markdown' });
});

bot.action('col_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  await ctx.reply('መስመር:', Markup.inlineKeyboard(ROUTES.map(r=>[Markup.button.callback(`${r.emoji} ${r.label}`,`col_${r.id}`)])));
});

bot.action(/^col_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  ctx.session = { step:'COL_LOC', colRoute:ctx.match[1] };
  await ctx.reply('ያሉበትን ቦታ ያጋሩ 👇', locKb());
});

bot.action('print_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  await ctx.reply('የትኛው መስመር?', Markup.inlineKeyboard(ROUTES.map(r=>[Markup.button.callback(`${r.emoji} ${r.label}`,`prnt_${r.id}`)])));
});

bot.action(/^prnt_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  await handlePrint(ctx, ctx.match[1]);
});

bot.action('channel_panel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  await ctx.reply(`ቻናል: ${CHANNEL_ID||'አልተቀመጠም'}`, Markup.inlineKeyboard([
    [Markup.button.callback('🧪 ፍተሻ','ch_test')],
    ...ROUTES.map(r=>[Markup.button.callback(`📣 ${r.emoji} ${r.label}`,`ch_ann_${r.id}`)]),
  ]));
});

bot.action('ch_test', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID አልተቀመጠም');
  try { await bot.telegram.sendMessage(CHANNEL_ID,'🧪 ፍተሻ ✅'); await ctx.reply('✅ ተሳክቷል'); }
  catch(e) { await ctx.reply(`❌ ${e.message}`); }
});

bot.action(/^ch_ann_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(()=>{}); return; }
  await ctx.answerCbQuery().catch(()=>{});
  if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID አልተቀመጠም');
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);
  try {
    await bot.telegram.sendMessage(CHANNEL_ID,
      `${ro.emoji} *${ro.label}*\n${capLine(total,ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
      { parse_mode:'Markdown' });
    await ctx.reply(`✅ ተልኳል — ${ro.label}`);
  } catch(e) { await ctx.reply(`❌ ${e.message}`); }
});

bot.command('report_now', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔');
  await sendDailyReport();
  await ctx.reply('✅ ሪፖርት ተልኳል');
});

bot.command('broadcast', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔');
  const text = ctx.message.text.replace(/^\/broadcast\s*/i,'').trim();
  if (!text) return ctx.reply('አጠቃቀም: /broadcast መልዕክት');
  const users = await Reg.distinct('userId', { status:{ $nin:['rejected'] } });
  let sent=0, failed=0;
  for (const uid of users) {
    try { await bot.telegram.sendMessage(uid,`📢 ${text}\n\n${SUPPORT_PHONE}`,{ parse_mode:'Markdown' }); sent++; }
    catch { failed++; }
    await new Promise(r=>setTimeout(r,50));
  }
  await ctx.reply(`✅ ተልኳል: ${sent} | ❌ አልደረሳቸውም: ${failed}`);
});

bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery('ጊዜው አልፏል — /start ይሞክሩ').catch(()=>{});
});

// ── LAUNCH ──
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await mongoose.connect(MONGO_URI, { maxPoolSize:20, serverSelectionTimeoutMS:10000, socketTimeoutMS:45000 });
  console.log('✅ MongoDB');

  await new Promise(resolve => {
    http.createServer((_,res)=>{ res.writeHead(200); res.end('OK'); })
      .listen(PORT, ()=>{ console.log('✅ Port',PORT); resolve(); });
  });

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates:true });
    console.log('✅ Webhook deleted');
  } catch(e) { console.warn('deleteWebhook:', e.message); }

  const RURL = (process.env.RENDER_EXTERNAL_URL||'').trim();
  if (RURL) {
    const https = require('https');
    setInterval(()=>{
      try {
        const u = new URL(RURL);
        https.request({ hostname:u.hostname, path:'/', method:'GET' }, r=>console.log('🔄',r.statusCode)).on('error',()=>{}).end();
      } catch {}
    }, 9*60*1000);
    console.log('✅ Keep-alive started');
  }

  startDailyReportScheduler();
  await bot.launch({ dropPendingUpdates:true });
  console.log('✅ Bot started');

  process.once('SIGINT',  ()=>{ bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', ()=>{ bot.stop('SIGTERM'); process.exit(0); });
}

main().catch(err=>{ console.error('❌',err.message); process.exit(1); });
