'use strict';

/* ============================================================
   የጋራ ጭነት ቦት — Telegram Cargo Group-Booking Bot
   Stack: Telegraf + MongoDB (mongoose) + Anthropic Claude (payment OCR check)
   ============================================================ */

const { Telegraf, Markup } = require('telegraf');
const mongoose              = require('mongoose');
const Anthropic             = require('@anthropic-ai/sdk');
const http                  = require('http');

/* ────────────────────────────────────────────────────────────
   1. CONFIG / ENV
   ──────────────────────────────────────────────────────────── */

const BOT_TOKEN         = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI         = process.env.MONGO_URI  || '';
const SUPPORT_PHONE     = process.env.SUPPORT_PHONE     || '0960336138';
const ADMIN_IDS         = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY || '';
const AI_AUTO_APPROVE   = (process.env.AI_AUTO_APPROVE  || 'true') === 'true';
const TARGET_KG_DEFAULT = Number(process.env.TARGET_KG_DEFAULT) || 5000;
const CHANNEL_ID        = (process.env.CHANNEL_ID || '').trim();
const GROUP_BUY_LINK    = (process.env.GROUP_BUY_LINK || '').trim();

const REG_PER_KG        = 10;
const SHIP_PER_KG       = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('BOT_TOKEN እና MONGO_URI ያስፈልጋሉ');
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

/* ────────────────────────────────────────────────────────────
   2. STATIC DATA — Routes (bidirectional) / Payment methods
   ──────────────────────────────────────────────────────────── */

const ROUTES_TO_AMHARA = [
  { id: 'aa_finotselam',   emoji: '🟢', label: 'አዲስ አበባ → ፍኖተሰላም',   targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_debre_markos', emoji: '🔵', label: 'አዲስ አበባ → ደብረ ማርቆስ', targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_mota',         emoji: '🟤', label: 'አዲስ አበባ → ሞጣ',         targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_bahirdar',     emoji: '🔵', label: 'አዲስ አበባ → ባህር ዳር',     targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_gondar',       emoji: '🟣', label: 'አዲስ አበባ → ጎንደር',       targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_debre_berhan', emoji: '🟡', label: 'አዲስ አበባ → ደብረ ብርሃን',  targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_kemissie',     emoji: '🟠', label: 'አዲስ አበባ → ከሚሴ',        targetKg: TARGET_KG_DEFAULT },
  { id: 'aa_dessie',       emoji: '🔴', label: 'አዲስ አበባ → ደሴ',         targetKg: TARGET_KG_DEFAULT },
];

const ROUTES_TO_AA = [
  { id: 'finotselam_aa',   emoji: '🟢', label: 'ፍኖተሰላም → አዲስ አበባ',   targetKg: TARGET_KG_DEFAULT },
  { id: 'debre_markos_aa', emoji: '🔵', label: 'ደብረ ማርቆስ → አዲስ አበባ', targetKg: TARGET_KG_DEFAULT },
  { id: 'mota_aa',         emoji: '🟤', label: 'ሞጣ → አዲስ አበባ',         targetKg: TARGET_KG_DEFAULT },
  { id: 'bahirdar_aa',     emoji: '🔵', label: 'ባህር ዳር → አዲስ አበባ',     targetKg: TARGET_KG_DEFAULT },
  { id: 'gondar_aa',       emoji: '🟣', label: 'ጎንደር → አዲስ አበባ',       targetKg: TARGET_KG_DEFAULT },
  { id: 'debre_berhan_aa', emoji: '🟡', label: 'ደብረ ብርሃን → አዲስ አበባ',  targetKg: TARGET_KG_DEFAULT },
  { id: 'kemissie_aa',     emoji: '🟠', label: 'ከሚሴ → አዲስ አበባ',        targetKg: TARGET_KG_DEFAULT },
  { id: 'dessie_aa',       emoji: '🔴', label: 'ደሴ → አዲስ አበባ',         targetKg: TARGET_KG_DEFAULT },
];

const ROUTES = [...ROUTES_TO_AMHARA, ...ROUTES_TO_AA];

const METHODS = [
  { id: 'telebirr', emoji: '📱', label: 'ቴሌብር',   info: process.env.TELEBIRR_INFO || 'Telebirr: 0960336138' },
  { id: 'cbe',      emoji: '🏦', label: 'CBE ባንክ', info: process.env.CBE_INFO      || 'CBE: 1000370308447'  },
];

const byRoute  = id => ROUTES.find(r => r.id === id);
const byMethod = id => METHODS.find(m => m.id === id);
const ACTIVE   = ['pending', 'reviewing', 'approved'];

/* ────────────────────────────────────────────────────────────
   3. DB MODELS
   ──────────────────────────────────────────────────────────── */

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
  status:         { type: String, default: 'pending', enum: ['pending', 'reviewing', 'approved', 'rejected', 'sent'] },
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

/* ── BotSettings (registration on/off + other global flags) ── */
const BotSettings = mongoose.model('BotSettings', new mongoose.Schema({
  key:   { type: String, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}));

async function getSetting(key, def = null) {
  try {
    const doc = await BotSettings.findOne({ key }).lean();
    return doc !== null && doc !== undefined ? doc.value : def;
  } catch {
    return def;
  }
}

async function setSetting(key, value) {
  await BotSettings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

/* ────────────────────────────────────────────────────────────
   4. SESSION MIDDLEWARE (Mongo-backed, per chat+user)
   ──────────────────────────────────────────────────────────── */

async function getSession(key) {
  try {
    const d = await Session.findOne({ key }).lean();
    return d?.data || {};
  } catch {
    return {};
  }
}

async function saveSession(key, data) {
  try {
    await Session.findOneAndUpdate({ key }, { data, updatedAt: new Date() }, { upsert: true });
  } catch {}
}

function sessionMW(ctx, next) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`;
  return getSession(key).then(data => {
    ctx.session = data;
    return next().then(() => saveSession(key, ctx.session));
  });
}

/* ────────────────────────────────────────────────────────────
   5. RATE LIMITING
   ──────────────────────────────────────────────────────────── */

const rateLimitMap = new Map();

function isRateLimited(userId, limit = 20) {
  const now = Date.now();
  const e = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 60_000; }
  e.count++;
  rateLimitMap.set(userId, e);
  return e.count > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) if (now > v.reset) rateLimitMap.delete(k);
}, 5 * 60_000);

/* ────────────────────────────────────────────────────────────
   6. GENERAL HELPERS
   ──────────────────────────────────────────────────────────── */

const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);

const ST = {
  pending:   'ክፍያ ይጠብቃል',
  reviewing: 'እየተፈተሸ ነው',
  approved:  'ተፈቅዷል',
  rejected:  'አልተቀበለም',
  sent:      'ተልኳል',
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId);
  const me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `ስም: ${r.fullName} | ስልክ: ${r.phone}\n` +
    `ጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `ክፍያ: ${me?.label || '—'} | ` +
    `አድራሻ: ${r.locationLat ? `[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : 'አልተላከም'}\n` +
    `ሁኔታ: ${ST[r.status]}`;
  if (r.aiAutoApproved) t += ' (AI ያረጋገጠ)';
  if (admin) t += `\n\`${r.userId}\`${r.username ? ' @' + r.username : ''}`;
  return t;
}

function capLine(total, target) {
  const pct    = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10);
  const remain = Math.max(0, target - total);
  return (
    '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + pct + '%\n' +
    'የተመዘገበ: ' + total + ' ኪሎ\n' +
    'ቀሪ: ' + remain + ' ኪሎ\n' +
    'ኢላማ: ' + target + ' ኪሎ'
  );
}

/* ────────────────────────────────────────────────────────────
   Admin panel keyboard builder (reusable — shows live toggle state)
   ──────────────────────────────────────────────────────────── */
async function adminPanelKb() {
  const regOpen = await getSetting('registration_open', true);
  return Markup.inlineKeyboard([
    [Markup.button.callback('አዲስ አበባ → አማራ ክልል ምዝገቦች', 'lst_dir_toamhara')],
    [Markup.button.callback('አማራ ክልል → አዲስ አበባ ምዝገቦች',  'lst_dir_toaa')],
    [Markup.button.callback('ያልተፈቀዱ ክፍያዎች',               'lst_pay')],
    [Markup.button.callback('ጭነት ሰብሳቢ (አቅራቢያ ዝርዝር)',      'col_pick')],
    [Markup.button.callback('ጭነት ላክ (ለደንበኞች ማሳወቂያ)',      'snd_pick')],
    [Markup.button.callback('የጭነት ሪፖርት',                   'admin_report')],
    [Markup.button.callback('ቻናል ማስታወቂያ',                  'channel_panel')],
    [Markup.button.callback('ዝርዝር አትም (Print Manifest)',    'print_pick')],
    [Markup.button.callback(
      regOpen ? '🔴 ምዝገባ አጥፋ  (አሁን ክፍት ነው)' : '🟢 ምዝገባ ክፈት  (አሁን ተዘግቷል)',
      'toggle_registration'
    )],
    [Markup.button.callback('📣 Group Buying ማስተዋወቅ', 'gb_invite_panel')],
  ]);
}

/* ────────────────────────────────────────────────────────────
   ዋና Keyboard
   ──────────────────────────────────────────────────────────── */
const mainKb = () => Markup.keyboard([
  ['🔼 አዲስ አበባ → አማራ ክልል', '🔽 አማራ ክልል → አዲስ አበባ'],
  ['📋 የምዝገባ ዝርዝሬ', '📊 የጭነት ቆጣሪ'],
  ['🛒 የቡድን ግዥ'],
  ...(ADMIN_IDS.length ? [['🔧 Admin']] : []),
]).resize();

const dirRoutesKb = routes => Markup.inlineKeyboard(
  routes.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `goto_${r.id}`)])
);

const locKb = () => Markup.keyboard([
  [Markup.button.locationRequest('📍 አድራሻዬን ላክ')],
  ['⏭️ ሳላጋራ ጨርስ'],
]).resize().oneTime();

const approveKb = id => Markup.inlineKeyboard([[
  Markup.button.callback('ፈቀድ',  `ok_${id}`),
  Markup.button.callback('ከልክል', `no_${id}`),
]]);

/* ────────────────────────────────────────────────────────────
   7. CAPACITY TRACKING
   ──────────────────────────────────────────────────────────── */

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
        `*${ro.label}* — ጭነቱ ሞልቷል!\n\nሠራተኞቻችን ቤትዎ ይሰበሰቡዎታል — ዝግጁ ይሁኑ.\n${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    for (const aid of ADMIN_IDS)
      bot.telegram.sendMessage(aid, `${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ | ${members.length} ሰው`).catch(() => {});

    if (CHANNEL_ID)
      bot.telegram.sendMessage(CHANNEL_ID,
        `*${ro.label}*\n${capLine(total, ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

/* ────────────────────────────────────────────────────────────
   8. AI PAYMENT VERIFICATION
   ──────────────────────────────────────────────────────────── */

async function checkPayment(fileId, reg) {
  if (!anthropic) return null;
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const res  = await fetch(link.href || String(link));
    if (!res.ok) throw new Error('fetch fail');
    const b64  = Buffer.from(await res.arrayBuffer()).toString('base64');
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const m    = byMethod(reg.paymentMethod);

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          {
            type: 'text',
            text:
              `Payment screenshot. Method:${m?.label} Account:"${m?.info}" Amount:${reg.totalPrice}ETB\n` +
              `Reply ONLY JSON: {"amount_match":true/false,"account_match":true/false,"looks_edited":true/false,"confidence":"high|medium|low","reason":"short amharic"}`,
          },
        ],
      }],
    });

    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('AI:', e.message);
    return null;
  }
}

const aiOk = r => r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === 'high';

const aiSummary = r => !r
  ? 'AI ማረጋገጫ አልተሳካም'
  : `AI: ${aiOk(r) ? 'ተረጋግጧል' : r?.looks_edited ? 'ሊስተካከል ይችላል' : 'አልተረጋገጠም'} (${r.confidence}) ${r.reason || ''}`;

/* ────────────────────────────────────────────────────────────
   9. GROUP BUYING INVITE HELPERS
   ──────────────────────────────────────────────────────────── */

async function buildGBMessage(botLink, groupLink) {
  return (
    `*🛒 የቡድን ግዥ (Group Buying) — ይቀላቀሉ!*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `ጤፍ፣ ዘይት፣ ስኳር፣ ዱቄት — ከብዙ ሰዎች ጋር\n` +
    `*በጋራ በርካሽ ዋጋ* ይግዙ!\n\n` +
    (botLink   ? `🤖 ቦቱን ለመጠቀም: ${botLink}\n`    : '') +
    (groupLink ? `👥 ቡድናችን ይቀላቀሉ: ${groupLink}\n` : '') +
    `\nለጥያቄ: ${SUPPORT_PHONE}`
  );
}

async function broadcastGB(msg) {
  const users = await Reg.distinct('userId', { status: { $nin: ['rejected'] } });
  let sent = 0;
  for (const uid of users) {
    try { await bot.telegram.sendMessage(uid, msg, { parse_mode: 'Markdown' }); sent++; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  return sent;
}

/* ────────────────────────────────────────────────────────────
   10. PRINTABLE MANIFEST (HTML)
   ──────────────────────────────────────────────────────────── */

const PRINT_STATUS = {
  approved:  'ፈቃድ ያለው',
  reviewing: 'እየተፈተሸ',
  pending:   'ያልከፈለ',
  sent:      'ተልኳል',
};

function buildManifestHTML(ro, list) {
  const totalKg   = list.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalReg  = totalKg * REG_PER_KG;
  const totalShip = totalKg * SHIP_PER_KG;

  const cnt = { approved: 0, reviewing: 0, pending: 0, sent: 0 };
  list.forEach(r => { if (cnt[r.status] !== undefined) cnt[r.status]++; });

  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-GB');
  const timeStr  = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const ORDER  = ['approved', 'sent', 'reviewing', 'pending'];
  const sorted = [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  const rows = sorted.map((r, i) => {
    const statusAm = PRINT_STATUS[r.status] || r.status;
    return `<tr>
      <td>${i + 1}</td>
      <td>${r.fullName || '—'}</td>
      <td>${r.phone || '—'}</td>
      <td>${r.cargoDesc || '—'}</td>
      <td class="num">${r.weightKg || 0}</td>
      <td class="status status-${r.status}">${statusAm}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ro.label} — የጭነት ዝርዝር</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Ethiopic', 'Nyala', 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 18px; font-size: 13px; }
  .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a3c6e; padding-bottom: 10px; margin-bottom: 14px; }
  .letterhead h1 { font-size: 18px; margin: 0 0 4px; color: #1a3c6e; }
  .letterhead .sub { font-size: 12px; color: #555; }
  .letterhead .meta { text-align: right; font-size: 12px; color: #333; }
  .route-banner { background: #1a3c6e; color: #fff; padding: 8px 14px; border-radius: 4px; font-size: 15px; font-weight: bold; margin-bottom: 14px; }
  .summary { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .box { border: 1px solid #ccc; border-radius: 5px; padding: 7px 13px; text-align: center; background: #f7f8fa; min-width: 95px; }
  .box .v { font-size: 18px; font-weight: bold; color: #1a3c6e; }
  .box .l { font-size: 10px; color: #666; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
  th { background: #1a3c6e; color: #fff; padding: 7px 6px; text-align: left; font-size: 11.5px; }
  td { padding: 6px 6px; border-bottom: 1px solid #ddd; }
  tr:nth-child(even) { background: #f5f6f8; }
  .num { text-align: center; }
  .status { text-align: center; font-weight: bold; font-size: 11px; }
  .status-approved { color: #1a7d3b; }
  .status-sent     { color: #1565c0; }
  .status-reviewing{ color: #b8860b; }
  .status-pending   { color: #888; }
  .footer { margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px; }
  .sign-box { width: 45%; }
  .sign-line { border-top: 1px solid #333; margin-top: 36px; padding-top: 4px; text-align: center; color: #444; }
  .stamp-note { margin-top: 26px; font-size: 11px; color: #777; text-align: center; }
  #printBtn { margin: 16px 0; padding: 10px 28px; font-size: 14px; background: #1a3c6e; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  @media print {
    #printBtn { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>

<button id="printBtn" onclick="window.print()">ይህን ፕሪንት ያድርጉ</button>

<div class="letterhead">
  <div>
    <h1>የጋራ ጭነት አገልግሎት</h1>
    <div class="sub">Cargo Group-Booking Manifest</div>
  </div>
  <div class="meta">
    ${dateStr} &nbsp; ${timeStr}<br>
    ${SUPPORT_PHONE}
  </div>
</div>

<div class="route-banner">${ro.emoji} ${ro.label}</div>

<div class="summary">
  <div class="box"><div class="v">${list.length}</div><div class="l">ጠቅላላ ተሳፋሪ/ጭነት</div></div>
  <div class="box"><div class="v">${totalKg}</div><div class="l">ጠቅላላ ኪሎ</div></div>
  <div class="box"><div class="v">${cnt.approved + cnt.sent}</div><div class="l">ፈቃድ ያላቸው</div></div>
  <div class="box"><div class="v">${cnt.pending + cnt.reviewing}</div><div class="l">በሂደት ላይ</div></div>
  <div class="box"><div class="v">${totalReg.toLocaleString('en')}</div><div class="l">የምዝገባ ክፍያ (ብር)</div></div>
  <div class="box"><div class="v">${totalShip.toLocaleString('en')}</div><div class="l">የጭነት ክፍያ (ብር)</div></div>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>ሙሉ ስም</th>
      <th>ስልክ ቁጥር</th>
      <th>የጭነት ዓይነት</th>
      <th class="num">ኪሎ</th>
      <th class="status">ሁኔታ</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<div class="footer">
  <div class="sign-box">
    <div class="sign-line">የሹፍር ስም እና ፊርማ — Driver Name &amp; Signature</div>
  </div>
  <div class="sign-box">
    <div class="sign-line">የተረከበ ባለሥልጣን ፊርማ — Receiving Officer Signature</div>
  </div>
</div>

<div class="stamp-note">ይህ ሰነድ በ${ro.label} የጭነት ጉዞ ላይ ላሉ ኬላዎች/ፖሊስ ማሳያ ሰነድ ነው።</div>

<script>
  window.addEventListener('load', () => setTimeout(() => window.print(), 400));
</script>
</body>
</html>`;
}

async function sendDocumentWithRetry(chatId, doc, extra, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await bot.telegram.sendDocument(chatId, doc, extra);
    } catch (e) {
      lastErr = e;
      console.error(`sendDocument attempt ${i + 1}/${retries} failed:`, e.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) { await ctx.reply('መስመር አልተገኘም'); return; }

  let waitMsg;
  try {
    waitMsg = await ctx.reply('ሰነዱ እየተዘጋጀ ነው፣ ትንሽ ይጠብቁ...');

    const list = await Reg.find({ routeId, status: { $ne: 'rejected' } }).sort({ createdAt: 1 }).lean();
    if (!list.length) {
      await ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);
      return;
    }

    const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    const html    = buildManifestHTML(ro, list);
    const buf     = Buffer.from(html, 'utf-8');
    const fname   = `${ro.id}_${new Date().toISOString().slice(0, 10)}.html`;

    await sendDocumentWithRetry(
      ctx.chat.id,
      { source: buf, filename: fname },
      {
        caption:
          `*${ro.label}* — ፕሪንት ዝግጁ ሰነድ\n` +
          `${list.length} ሰው | ${totalKg} ኪሎ\n\n` +
          `ፋይሉን ይክፈቱ — በራስ-ሰር ፕሪንት ይከፈታል\n` +
          `(ካልተከፈተ Chrome ይክፈቱና ፕሪንት ቁልፉን ይጫኑ)\n\n` +
          `ይህን ሰነድ ለፖሊስ/ኬላ ማሳያ ይጠቀሙ።`,
        parse_mode: 'Markdown',
      }
    );

    if (waitMsg) bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
  } catch (e) {
    console.error('handlePrint error:', e.message);
    await ctx.reply(
      `ፋይሉን መላክ አልተሳካም (${e.message})\n\n` +
      `ኢንተርኔት ላይ ችግር ሊሆን ይችላል — ትንሽ ቆይተው እንደገና ይሞክሩ።`
    ).catch(() => {});
  }
}

/* ────────────────────────────────────────────────────────────
   11. DAILY REPORT
   ──────────────────────────────────────────────────────────── */

async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;

  let txt = `ዕለታዊ ሪፖርት — ${new Date().toLocaleDateString('am-ET')}\n\n`;
  let gKg = 0, gPeople = 0, gPending = 0;

  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 }, kg: { $sum: '$weightKg' } } },
    ]);
    const m = {};
    counts.forEach(c => { m[c._id] = { n: c.n, kg: c.kg }; });

    const people = counts.reduce((s, c) => s + c.n, 0);
    const kg = (m.pending?.kg || 0) + (m.reviewing?.kg || 0) + (m.approved?.kg || 0) + (m.sent?.kg || 0);

    gKg += kg;
    gPeople += people;
    gPending += (m.pending?.n || 0) + (m.reviewing?.n || 0);

    if (!people) continue;
    txt += `${ro.emoji} ${ro.label}\n`;
    txt += `${people} ሰው | ${kg} ኪሎ | ፈቃድ: ${m.approved?.n || 0} | ፍተሻ: ${m.reviewing?.n || 0} | ያልከፈለ: ${m.pending?.n || 0} | ተልኳል: ${m.sent?.n || 0}\n\n`;
  }

  txt += `ጠቅላላ: ${gPeople} ሰው | ${gKg} ኪሎ | ያልተፈቀዱ: ${gPending}\n`;
  txt += `ምዝ. ክፍያ: ${(gKg * REG_PER_KG).toLocaleString()} ብ | ጭ. ክፍያ: ${(gKg * SHIP_PER_KG).toLocaleString()} ብ`;

  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, txt).catch(() => {});
  console.log('Daily report sent');
}

function startDailyReportScheduler() {
  let last = '';
  setInterval(async () => {
    const eat  = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const date = eat.toISOString().slice(0, 10);
    if (eat.getUTCHours() === 7 && eat.getUTCMinutes() === 0 && last !== date) {
      last = date;
      await sendDailyReport().catch(e => console.error('Daily report:', e.message));
    }
  }, 60_000);
}

/* ────────────────────────────────────────────────────────────
   12. BOT INSTANCE + GLOBAL MIDDLEWARE
   ──────────────────────────────────────────────────────────── */

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 120_000,
  telegram: { timeout: 120 },
});

bot.use(sessionMW);

bot.use(async (ctx, next) => {
  if (ctx.from?.id && !isAdmin(ctx) && isRateLimited(ctx.from.id))
    return ctx.reply('ብዙ ጥያቄ — ትንሽ ይጠብቁ').catch(() => {});
  return next();
});

bot.catch((err, ctx) => console.error('Bot error:', err?.message, ctx?.updateType));

/* ────────────────────────────────────────────────────────────
   13. /start — WELCOME
   ──────────────────────────────────────────────────────────── */

function welcomeText(name) {
  return (
    `*እንኳን ደህና መጡ, ${name}!*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*የጋራ ጭነት አገልግሎት*\n` +
    `_ከአዲስ አበባ ↔ አማራ ክልል_\n\n` +
    `*ጥቅሞቻችን:*\n` +
    `• ቤትዎ ድረስ ጭነት እንሰበስባለን\n` +
    `• ርካሽ ዋጋ — ከሌሎች ጋር አካፍለን\n` +
    `• ፈጣን እና አስተማማኝ አገልግሎት\n` +
    `• ሁሉም ነገር በቦት ይከናወናል\n\n` +
    `*እንዴት ይሰራል?*\n` +
    `1) አዲስ አበባ → አማራ ክልል ወይም አማራ ክልል → አዲስ አበባ ይምረጡ → ከተማ ይምረጡ\n` +
    `2) ስም → ስልክ → ጭነት ዓይነት → ክብደት (ኪሎ) ያስገቡ\n` +
    `3) ቴሌብር ወይም CBE ይምረጡ → ይክፈሉ → ደረሰኝ ፎቶ ይላኩ\n` +
    `4) አድራሻዎን ያጋሩ — ቤትዎ ድረስ እንሰበስባለን\n\n` +
    `*ዋጋ:*\n` +
    `• የምዝገባ ክፍያ: *${REG_PER_KG} ብር/ኪሎ* (አሁን)\n` +
    `• የጭነት ክፍያ: *${SHIP_PER_KG} ብር/ኪሎ* (ሲሰበሰብ)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*የቡድን ግዥ (Group Buying):*\n` +
    `ጤፍ፣ ዘይት፣ ስኳር እና ሌሎች ምርቶችን\n` +
    `በጋራ በርካሽ ዋጋ ለመግዛት\n` +
    `"🛒 የቡድን ግዥ" የሚለውን ቁልፍ ይጫኑ\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*📋 የምዝገባ ዝርዝሬ* — ምዝገባዎችዎን ለማየት/ለመሰረዝ\n` +
    `*📊 የጭነት ቆጣሪ* — እያንዳንዱ መስመር ስንት ኪሎ እንደሞላ ለማየት\n\n` +
    `ለጥያቄ: ${SUPPORT_PHONE}\n\n` +
    `*አቅጣጫ ይምረጡ:*`
  );
}

bot.start(async ctx => {
  ctx.session = {};
  const name = ctx.from?.first_name || 'እንኳን ደህና መጡ';
  await ctx.reply(welcomeText(name), { parse_mode: 'Markdown', ...mainKb() });
});

bot.command('help', async ctx => {
  ctx.session = {};
  const name = ctx.from?.first_name || 'እንኳን ደህና መጡ';
  await ctx.reply(welcomeText(name), { parse_mode: 'Markdown', ...mainKb() });
});

/* ────────────────────────────────────────────────────────────
   14. ቆጣሪ / ምዝገባዬ
   ──────────────────────────────────────────────────────────── */

bot.hears('📊 የጭነት ቆጣሪ', async ctx => {
  ctx.session = {};

  let txt = '*የጭነት ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n';
  txt += '*አዲስ አበባ → አማራ ክልል*\n\n';
  for (const ro of ROUTES_TO_AMHARA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }
  txt += '*አማራ ክልል → አዲስ አበባ*\n\n';
  for (const ro of ROUTES_TO_AA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }

  await ctx.reply(txt, { parse_mode: 'Markdown', ...mainKb() });
});

bot.hears('📋 የምዝገባ ዝርዝሬ', async ctx => {
  ctx.session = {};
  const list = await Reg.find({ userId: ctx.from.id, status: { $nin: ['rejected'] } }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply('ምዝገባ የለዎትም። አቅጣጫ ይምረጡ', mainKb());

  for (const r of list) {
    const btns = [];
    if (r.status !== 'sent') btns.push(Markup.button.callback('ሰርዝ', `del_${r._id}`));
    if (!r.locationLat && r.status !== 'sent') btns.push(Markup.button.callback('አድራሻ ላክ', `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode: 'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}) });
  }
});

bot.action(/^addloc_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('አድራሻዎን ያጋሩ:', locKb());
});

/* ────────────────────────────────────────────────────────────
   14b. የቡድን ግዥ — Group Buying (user-facing)
   ──────────────────────────────────────────────────────────── */

bot.hears('🛒 የቡድን ግዥ', async ctx => {
  ctx.session = {};

  const linkLine = GROUP_BUY_LINK
    ? `\nለምዝገባ: ${GROUP_BUY_LINK}`
    : `\nለምዝገባ ወይም ለተጨማሪ መረጃ: ${SUPPORT_PHONE}`;

  await ctx.reply(
    `*የቡድን ግዥ (Group Buying)*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `ጤፍ፣ ዘይት፣ ስኳር፣ ዱቄት እና ሌሎች ምርቶችን\n` +
    `*ከብዙ ሰዎች ጋር በጋራ* በርካሽ ዋጋ ግዙ!\n\n` +
    `*እንዴት ይሰራል?*\n` +
    `1) ጥያቄ ያስገቡ — ምን ዓይነት ምርት ምን ያህል?\n` +
    `2) ሌሎች ተሳታፊዎች ሲሰባሰቡ ዋጋ ይቀንሳል\n` +
    `3) ጋራ ዋጋ ሲደርስ ትዕዛዝ ይቆረጣል\n` +
    `4) ዕቃው ቤትዎ ድረስ ይደርሳል\n\n` +
    `*ጥቅሞቹ:*\n` +
    `• ከገበያ ዋጋ ያነሰ — ትልቅ ትዕዛዝ = ርካሽ ዋጋ\n` +
    `• ደህንነቱ የተጠበቀ — ቅድሚያ ክፍያ ሳያስፈልግ\n` +
    `• ሁሉም አካባቢ ይደርሳል\n\n` +
    `${linkLine}`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

/* ────────────────────────────────────────────────────────────
   15. ROUTE SELECTION → START REGISTRATION
   ──────────────────────────────────────────────────────────── */

async function startRegistration(ctx, route) {
  // ── Registration ON/OFF check ──────────────────────────────
  const regOpen = await getSetting('registration_open', true);
  if (!regOpen) {
    return ctx.reply(
      '⏸️ *ምዝገባ ለጊዜው ተቋርጧል*\n\n' +
      'አስተዳዳሪዎቻችን ምዝገባ ሲከፍቱ ይነገርዎታል።\n\n' +
      `ለጥያቄ: ${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown', ...mainKb() }
    );
  }
  // ────────────────────────────────────────────────────────────

  const ex = await Reg.findOne({ userId: ctx.from.id, routeId: route.id, status: { $nin: ['rejected', 'sent'] } }).lean();
  if (ex) {
    const btns = [Markup.button.callback('ሰርዝ', `del_${ex._id}`)];
    if (!ex.locationLat) btns.push(Markup.button.callback('አድራሻ ላክ', `addloc_${ex._id}`));
    btns.push(Markup.button.callback('ሌላ እቃ ጨምር', `more_${route.id}`));
    return ctx.reply(card(ex) + '\n\n_ቀደም ሲል ተመዝግበዋል_', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([btns]) });
  }
  ctx.session = { step: 'NAME', routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}*\n\nሙሉ ስምዎን ያስገቡ:`, { parse_mode: 'Markdown', ...mainKb() });
}

bot.hears('🔼 አዲስ አበባ → አማራ ክልል', async ctx => {
  ctx.session = {};
  await ctx.reply('*አዲስ አበባ → አማራ ክልል* — መስመር ይምረጡ:', { parse_mode: 'Markdown', ...dirRoutesKb(ROUTES_TO_AMHARA) });
});

bot.hears('🔽 አማራ ክልል → አዲስ አበባ', async ctx => {
  ctx.session = {};
  await ctx.reply('*አማራ ክልል → አዲስ አበባ* — መስመር ይምረጡ:', { parse_mode: 'Markdown', ...dirRoutesKb(ROUTES_TO_AA) });
});

bot.action(/^goto_(.+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  await startRegistration(ctx, route);
});

bot.action(/^more_(.+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  ctx.session = { step: 'NAME', routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}* — ሌላ እቃ ጨምር\n\nሙሉ ስምዎን ያስገቡ:`, { parse_mode: 'Markdown', ...mainKb() });
});

/* ────────────────────────────────────────────────────────────
   16. PAYMENT METHOD SELECTION → CREATE REGISTRATION
   ──────────────────────────────────────────────────────────── */

bot.action(/^pm_(.+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'PAYMETHOD') return;
  const m = byMethod(ctx.match[1]);
  if (!m) return;

  const { d, routeId } = ctx.session;
  ctx.session = {};

  const r = await Reg.create({
    userId: ctx.from.id, username: ctx.from.username || '',
    fullName: d.name, phone: d.phone, routeId,
    cargoDesc: d.cargo, weightKg: d.kg,
    totalPrice: d.kg * REG_PER_KG, paymentMethod: m.id, status: 'pending',
  });

  await checkCapacity(routeId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  const acct = m.info.includes(':') ? m.info.split(':').slice(1).join(':').trim() : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ቁጥር: \`${acct}\`\n\n` +
    `*${r.totalPrice} ብር* ይክፈሉ\n\n` +
    `ከዚያ *ደረሰኝ ፎቶ* ላኩ`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

/* ────────────────────────────────────────────────────────────
   17. TEXT-DRIVEN REGISTRATION FLOW
   ──────────────────────────────────────────────────────────── */

bot.on('text', async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();

  const txt = ctx.message.text.trim();
  const reserved = [
    '📋 የምዝገባ ዝርዝሬ', '📊 የጭነት ቆጣሪ', '🔧 Admin', '⏭️ ሳላጋራ ጨርስ',
    '🔼 አዲስ አበባ → አማራ ክልል', '🔽 አማራ ክልል → አዲስ አበባ', '🛒 የቡድን ግዥ',
  ];
  if (reserved.includes(txt)) return next();

  if (step === 'PAYMETHOD') return ctx.reply('ከቁልፍ ይምረጡ');

  if (step === 'NAME') {
    if (txt.length < 3) return ctx.reply('ሙሉ ስም ያስገቡ (3+ ፊደል)');
    ctx.session.d.name = txt;
    ctx.session.step = 'PHONE';
    return ctx.reply('ስልክ ቁጥርዎን ያስገቡ:');
  }

  if (step === 'PHONE') {
    const phone = txt.replace(/\s/g, '');
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply('ትክክለኛ ስልክ ያስገቡ\nምሳሌ: 0912345678');
    ctx.session.d.phone = phone;
    ctx.session.step = 'CARGO';
    return ctx.reply('ጭነት ዓይነት (ምን ዓይነት እቃ?):');
  }

  if (step === 'CARGO') {
    ctx.session.d.cargo = txt;
    ctx.session.step = 'WEIGHT';
    return ctx.reply('ክብደት (ኪሎ):');
  }

  if (step === 'WEIGHT') {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ''));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply('ትክክለኛ ቁጥር ያስገቡ (1–2000)');
    ctx.session.d.kg = kg;
    ctx.session.step = 'PAYMETHOD';
    return ctx.reply(
      `*ማጠቃለያ*\n━━━━━━━━━━━━━━━━\n` +
      `ስም: ${ctx.session.d.name}\n` +
      `ጭነት: ${ctx.session.d.cargo} — *${kg} ኪሎ*\n` +
      `የምዝገባ ክፍያ: *${kg * REG_PER_KG} ብር*\n` +
      `የጭነት ክፍያ: ${kg * SHIP_PER_KG} ብር (ሲሰበሰብ)\n\n` +
      `ክፍያ መንገድ ይምረጡ:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(METHODS.map(m => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)])) }
    );
  }

  if (step === 'LOC') {
    ctx.session.locTries = (ctx.session.locTries || 0) + 1;
    if (ctx.session.locTries >= 3) return ctx.reply(`ቁልፉን ይጫኑ | ${SUPPORT_PHONE}`, locKb());
    return ctx.reply('ቁልፉን ይጫኑ:', locKb());
  }

  if (step === 'SEND_NOTE') {
    if (!isAdmin(ctx)) { ctx.session = {}; return next(); }
    const ro = byRoute(ctx.session.sendRoute);
    ctx.session = {};

    const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
    if (!ready.length) return ctx.reply('ፈቃድ ያለው ምዝገባ የለም', mainKb());

    await Reg.updateMany({ _id: { $in: ready.map(r => r._id) } }, { status: 'sent' });

    let sent = 0;
    for (const r of ready) {
      try {
        await bot.telegram.sendMessage(r.userId,
          `*ጭነትዎ ተልኳል!*\n${byRoute(r.routeId)?.label}\n\n${txt}\n\n${SUPPORT_PHONE}`,
          { parse_mode: 'Markdown' });
        sent++;
      } catch {}
    }
    return ctx.reply(`ተልኳል — ${ready.length} ሰው (${sent} ደርሷቸዋል)`, mainKb());
  }

  return next();
});

/* ────────────────────────────────────────────────────────────
   18. LOCATION HANDLING
   ──────────────────────────────────────────────────────────── */

bot.on('location', async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude: lat, longitude: lng } = ctx.message.location;

  if (step === 'COL_LOC' && isAdmin(ctx)) {
    const ro = byRoute(ctx.session.colRoute);
    ctx.session = {};

    const list = await Reg.find({ routeId: ro?.id, status: { $in: ACTIVE } }).lean();
    if (!list.length) return ctx.reply(`${ro?.label} — ምዝገባ የለም`, mainKb());

    function km(a1, o1, a2, o2) {
      const R = 6371, da = (a2 - a1) * Math.PI / 180, dl = (o2 - o1) * Math.PI / 180;
      const x = Math.sin(da / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dl / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    const sorted = list
      .map(r => ({ ...r, dist: r.locationLat ? km(lat, lng, r.locationLat, r.locationLng) : 9999 }))
      .sort((a, b) => a.dist - b.dist);

    await ctx.reply(`${ro?.label} — ${sorted.length} ሰው`);
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      await ctx.reply(`${i + 1}. ${r.fullName} | ${r.phone} | ${r.weightKg}ኪ | ${r.dist < 9999 ? r.dist.toFixed(1) + 'ኪሜ' : '—'}`);
      if (r.locationLat) await bot.telegram.sendLocation(ctx.chat.id, r.locationLat, r.locationLng).catch(() => {});
    }
    return;
  }

  if (step === 'LOC') {
    const regId = ctx.session.locRegId;
    ctx.session = {};

    const r = await Reg.findByIdAndUpdate(regId, { locationLat: lat, locationLng: lng }, { new: true });
    if (!r) return ctx.reply('ምዝገባ አልተገኘም', mainKb());

    const total = await routeWeight(r.routeId);
    const ro2   = byRoute(r.routeId);

    await ctx.reply(
      `*ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n\n` +
      `${ro2?.emoji} *${ro2?.label}*\n` +
      `${capLine(total, ro2?.targetKg || TARGET_KG_DEFAULT)}\n\n` +
      `ጭነቱ ሲሞላ ቤትዎ ይሰበሰብለዎታል\n${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown', ...mainKb() }
    );

    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid, `አድራሻ ደረሰ: ${r.fullName} (${r.phone}) → ${ro2?.label}`).catch(() => {});
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }

  return next();
});

bot.hears('⏭️ ሳላጋራ ጨርስ', async ctx => {
  if (ctx.session?.step !== 'LOC') return ctx.reply('አቅጣጫ ይምረጡ', mainKb());

  const regId = ctx.session.locRegId;
  ctx.session = {};

  await ctx.reply(
    `*ምዝገባ ተጠናቀቀ!*\n\n` +
    `አድራሻ ኋላ ለማጨምር:\n"📋 የምዝገባ ዝርዝሬ" → "አድራሻ ላክ"\n\n${SUPPORT_PHONE}`,
    mainKb()
  );

  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r) for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, `አድራሻ አልተላከም — ${r.fullName} (${r.phone})`).catch(() => {});
  }
});

/* ────────────────────────────────────────────────────────────
   19. PAYMENT PHOTO → AI VERIFICATION → ADMIN REVIEW
   ──────────────────────────────────────────────────────────── */

bot.on('photo', async ctx => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: 'pending' }).sort({ createdAt: -1 });
  if (!r) return ctx.reply('ምዝገባ አልተገኘም። አቅጣጫ ይምረጡ', mainKb());

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = 'reviewing';
  await r.save();

  await ctx.reply('ፎቶ ደርሷል — ክፍያ እየተረጋገጠ ነው...');

  const verdict = await checkPayment(fileId, r);
  r.aiVerdict   = verdict;
  const autoOk  = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) { r.status = 'approved'; r.aiAutoApproved = true; }
  await r.save();

  bot.telegram.sendMessage(ctx.from.id,
    autoOk
      ? `*ክፍያ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`
      : `ፎቶ ደርሷል. ክፍያ እየተፈተሸ ነው — ትንሽ ይጠብቁ.\n${SUPPORT_PHONE}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('አድራሻዎን ያጋሩ — ቤትዎ ይሰበሰብለዎታል:', locKb());

  const caption = aiSummary(verdict) + '\n\n' + (autoOk ? 'AI ያረጋገጠ\n\n' : '') + card(r.toObject(), true);
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk ? 'ሰርዝ' : 'ፈቀድ', autoOk ? `no_${r._id}` : `ok_${r._id}`),
    Markup.button.callback('ከልክል', `no_${r._id}`),
  ]]);

  for (const aid of ADMIN_IDS) bot.telegram.sendPhoto(aid, fileId, { caption, parse_mode: 'Markdown', ...kb }).catch(() => {});
});

/* ────────────────────────────────────────────────────────────
   20. ADMIN PANEL
   ──────────────────────────────────────────────────────────── */

bot.hears('🔧 Admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('ፈቃድ የለዎትም');
  ctx.session = {};
  await ctx.reply('*የአስተዳዳሪ ፓነል*', { parse_mode: 'Markdown', ...(await adminPanelKb()) });
});

bot.action('lst_dir_toamhara', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አዲስ አበባ → አማራ ክልል — መስመር ምረጥ:', Markup.inlineKeyboard(
    ROUTES_TO_AMHARA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)])
  ));
});

bot.action('lst_dir_toaa', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አማራ ክልል → አዲስ አበባ — መስመር ምረጥ:', Markup.inlineKeyboard(
    ROUTES_TO_AA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)])
  ));
});

bot.action('lst_pay', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const list = await Reg.find({ status: 'reviewing' }).sort({ createdAt: 1 }).lean();
  if (!list.length) return ctx.reply('ያልተፈቀደ ክፍያ የለም');

  for (const r of list) {
    const txt = aiSummary(r.aiVerdict) + '\n\n' + card(r, true);
    if (r.paymentFileId) await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: 'Markdown', ...approveKb(r._id) });
    else await ctx.reply(txt, { parse_mode: 'Markdown', ...approveKb(r._id) });
  }
});

bot.action(/^lst_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const ro = byRoute(ctx.match[1]);
  if (!ro) return;

  const list = await Reg.find({ routeId: ro.id }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);

  const cnt = {};
  list.forEach(r => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const total = await routeWeight(ro.id);

  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n` +
    `${list.length} ሰው | ፈቃድ: ${cnt.approved || 0} | ፍተሻ: ${cnt.reviewing || 0} | ያልከፈለ: ${cnt.pending || 0} | ተልኳል: ${cnt.sent || 0}\n` +
    `${capLine(total, ro.targetKg)}`,
    { parse_mode: 'Markdown' }
  );

  for (const r of list) {
    const kb = r.status === 'reviewing' ? approveKb(r._id)
      : r.status === 'approved' ? Markup.inlineKeyboard([[Markup.button.callback('ሰርዝ', `no_${r._id}`)]])
      : {};
    await ctx.reply(card(r, true), { parse_mode: 'Markdown', ...kb });
  }
});

/* ── Status change helper ── */
async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status: newStatus }, { new: true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx[fn](card(r.toObject(), true), { parse_mode: 'Markdown' }).catch(() => {});
  if (notifyFn) bot.telegram.sendMessage(r.userId, notifyFn(r), { parse_mode: 'Markdown' }).catch(() => {});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery('ተፈቅዷል').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'approved', r =>
    `*ክፍያ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`
  );
});

bot.action(/^no_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery('አልተቀበለም').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'rejected', () =>
    `ክፍያ አልተቀበለም.\n${SUPPORT_PHONE}`
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === 'sent') return ctx.reply('ጭነቱ ተልኳል — መሰረዝ አይቻልም');

  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply('ምዝገባ ተሰርዟል. ለመመዝገብ አቅጣጫ ይምረጡ', mainKb());
});

/* ── Admin: Registration ON/OFF toggle ── */
bot.action('toggle_registration', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const current = await getSetting('registration_open', true);
  const next    = !current;
  await setSetting('registration_open', next);

  await ctx.reply(
    next
      ? '🟢 *ምዝገባ ተከፈተ!*\n\nደንበኞች አሁን መመዝገብ ይችላሉ።'
      : '🔴 *ምዝገባ ተዘጋ!*\n\nደንበኞች ሲሞክሩ "ምዝገባ ለጊዜው ተቋርጧል" ይነገራቸዋል።',
    { parse_mode: 'Markdown' }
  );

  // Updated panel with new toggle label
  await ctx.reply('*የአስተዳዳሪ ፓነል* (ተዘምኗል)', { parse_mode: 'Markdown', ...(await adminPanelKb()) });
});

/* ── Admin: Group Buying invite panel ── */
bot.action('gb_invite_panel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  await ctx.reply(
    '*📣 Group Buying ማስተዋወቅ*\n\nምን ይላክ?',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('🤖 Bot link ብቻ',                'gb_send_bot')],
      [Markup.button.callback('👥 Group invite link ብቻ',       'gb_send_group')],
      [Markup.button.callback('📢 Channel post ብቻ',            'gb_send_channel')],
      [Markup.button.callback('📣 ሁሉም (Bot + Group + Channel)', 'gb_send_all')],
    ])
  });
});

bot.action('gb_send_bot', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const botInfo = await bot.telegram.getMe();
  const botLink = `https://t.me/${botInfo.username}`;
  const msg     = await buildGBMessage(botLink, null);

  await ctx.reply('ለሁሉም ተጠቃሚዎች እየተላከ ነው...');
  const sent = await broadcastGB(msg);
  await ctx.reply(`🤖 *Bot link ተልኳል*\n${sent} ሰው ደርሷቸዋል`, { parse_mode: 'Markdown' });
});

bot.action('gb_send_group', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  if (!GROUP_BUY_LINK) return ctx.reply('⚠️ GROUP_BUY_LINK env variable አልተቀመጠም\n\nRender ውስጥ ያስገቡ');

  const msg = await buildGBMessage(null, GROUP_BUY_LINK);
  await ctx.reply('ለሁሉም ተጠቃሚዎች እየተላከ ነው...');
  const sent = await broadcastGB(msg);
  await ctx.reply(`👥 *Group invite ተልኳል*\n${sent} ሰው ደርሷቸዋል`, { parse_mode: 'Markdown' });
});

bot.action('gb_send_channel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  if (!CHANNEL_ID) return ctx.reply('⚠️ CHANNEL_ID env variable አልተቀመጠም');

  const botInfo = await bot.telegram.getMe();
  const botLink = `https://t.me/${botInfo.username}`;
  const msg     = await buildGBMessage(botLink, GROUP_BUY_LINK || null);

  try {
    await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' });
    await ctx.reply('📢 *Channel post ተልኳል*', { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.reply(`❌ አልተሳካም: ${e.message}`);
  }
});

bot.action('gb_send_all', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const botInfo = await bot.telegram.getMe();
  const botLink = `https://t.me/${botInfo.username}`;
  const msg     = await buildGBMessage(botLink, GROUP_BUY_LINK || null);

  await ctx.reply('ለሁሉም እየተላከ ነው — ትንሽ ይጠብቁ...');

  // 1) ሁሉም ተጠቃሚዎች (bot link + group link)
  const sent = await broadcastGB(msg);

  // 2) Channel
  let chOk = false;
  if (CHANNEL_ID) {
    try { await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' }); chOk = true; } catch {}
  }

  await ctx.reply(
    `📣 *Group Buying ማስተዋወቅ ተጠናቀቀ*\n\n` +
    `👥 ለተጠቃሚዎች: ${sent} ሰው\n` +
    `📢 Channel: ${chOk ? 'ተልኳል ✅' : CHANNEL_ID ? 'አልተሳካም ❌' : 'CHANNEL_ID የለም —'}`,
    { parse_mode: 'Markdown' }
  );
});

/* ── Admin: "send shipment" flow ── */
bot.action('snd_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('ምን አቅጣጫ?', Markup.inlineKeyboard([
    [Markup.button.callback('አዲስ አበባ → አማራ ክልል', 'snd_dir_toamhara')],
    [Markup.button.callback('አማራ ክልል → አዲስ አበባ',  'snd_dir_toaa')],
  ]));
});

bot.action('snd_dir_toamhara', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አዲስ አበባ → አማራ ክልል:', Markup.inlineKeyboard(ROUTES_TO_AMHARA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])));
});

bot.action('snd_dir_toaa', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አማራ ክልል → አዲስ አበባ:', Markup.inlineKeyboard(ROUTES_TO_AA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])));
});

bot.action(/^snd_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  const ro    = byRoute(ctx.match[1]);
  if (!ro) return;
  const ready = await Reg.find({ routeId: ro.id, status: 'approved' }).lean();
  if (!ready.length) return ctx.reply('ፈቃድ ያለው ምዝገባ የለም');

  const total = ready.reduce((s, r) => s + (r.weightKg || 0), 0);
  ctx.session = { step: 'SEND_NOTE', sendRoute: ro.id };
  await ctx.reply(`${ro.label} | ${ready.length} ሰው | ${total} ኪሎ\n\nለደንበኞች ማስታወሻ ያስገቡ:`);
});

/* ── Admin: route report ── */
bot.action('admin_report', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});

  let txt = '*የጭነት ሪፖርት*\n━━━━━━━━━━━━━━━━\n\n';
  txt += '*አዲስ አበባ → አማራ ክልል*\n';
  for (const ro of ROUTES_TO_AMHARA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const m = {}; counts.forEach(c => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\n`;
    txt += `ፈቃድ: ${m.approved || 0} | ፍተሻ: ${m.reviewing || 0} | ያልከፈለ: ${m.pending || 0} | ተልኳል: ${m.sent || 0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  txt += '*አማራ ክልል → አዲስ አበባ*\n';
  for (const ro of ROUTES_TO_AA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const m = {}; counts.forEach(c => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\n`;
    txt += `ፈቃድ: ${m.approved || 0} | ፍተሻ: ${m.reviewing || 0} | ያልከፈለ: ${m.pending || 0} | ተልኳል: ${m.sent || 0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  await ctx.reply(txt, { parse_mode: 'Markdown' });
});

/* ── Admin: "collector" mode ── */
bot.action('col_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አቅጣጫ ምረጥ:', Markup.inlineKeyboard([
    [Markup.button.callback('አዲስ አበባ → አማራ ክልል', 'col_dir_toamhara')],
    [Markup.button.callback('አማራ ክልል → አዲስ አበባ',  'col_dir_toaa')],
  ]));
});

bot.action('col_dir_toamhara', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አዲስ አበባ → አማራ ክልል:', Markup.inlineKeyboard(ROUTES_TO_AMHARA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])));
});

bot.action('col_dir_toaa', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አማራ ክልል → አዲስ አበባ:', Markup.inlineKeyboard(ROUTES_TO_AA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])));
});

bot.action(/^col_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: 'COL_LOC', colRoute: ctx.match[1] };
  await ctx.reply('ያሉበትን ቦታ ያጋሩ:', locKb());
});

/* ── Admin: print manifest ── */
bot.action('print_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አቅጣጫ ምረጥ:', Markup.inlineKeyboard([
    [Markup.button.callback('አዲስ አበባ → አማራ ክልል', 'prnt_dir_toamhara')],
    [Markup.button.callback('አማራ ክልል → አዲስ አበባ',  'prnt_dir_toaa')],
  ]));
});

bot.action('prnt_dir_toamhara', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አዲስ አበባ → አማራ ክልል — መስመር ምረጥ:', Markup.inlineKeyboard(
    ROUTES_TO_AMHARA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])
  ));
});

bot.action('prnt_dir_toaa', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አማራ ክልል → አዲስ አበባ — መስመር ምረጥ:', Markup.inlineKeyboard(
    ROUTES_TO_AA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])
  ));
});

bot.action(/^prnt_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await handlePrint(ctx, ctx.match[1]);
});

/* ── Admin: channel announcements ── */
bot.action('channel_panel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(`ቻናል: ${CHANNEL_ID || 'አልተቀመጠም'}`, Markup.inlineKeyboard([
    [Markup.button.callback('ፍተሻ ላክ', 'ch_test')],
    [Markup.button.callback('አዲስ አበባ → አማራ ክልል ማስታወቂያ', 'ch_dir_toamhara')],
    [Markup.button.callback('አማራ ክልል → አዲስ አበባ ማስታወቂያ',  'ch_dir_toaa')],
  ]));
});

bot.action('ch_dir_toamhara', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አዲስ አበባ → አማራ ክልል ማስታወቂያ:', Markup.inlineKeyboard(ROUTES_TO_AMHARA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`)])));
});

bot.action('ch_dir_toaa', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('አማራ ክልል → አዲስ አበባ ማስታወቂያ:', Markup.inlineKeyboard(ROUTES_TO_AA.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`)])));
});

bot.action('ch_test', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID አልተቀመጠም');
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, 'ፍተሻ ተሳክቷል');
    await ctx.reply('ተሳክቷል');
  } catch (e) {
    await ctx.reply(`አልተሳካም: ${e.message}`);
  }
});

bot.action(/^ch_ann_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('ፈቃድ የለዎትም').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID አልተቀመጠም');

  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);

  try {
    await bot.telegram.sendMessage(CHANNEL_ID,
      `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown' });
    await ctx.reply(`ተልኳል — ${ro.label}`);
  } catch (e) {
    await ctx.reply(`አልተሳካም: ${e.message}`);
  }
});

/* ── Admin commands ── */
bot.command('report_now', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('ፈቃድ የለዎትም');
  await sendDailyReport();
  await ctx.reply('ሪፖርት ተልኳል');
});

bot.command('stats', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('ፈቃድ የለዎትም');

  const now  = new Date();
  const date = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  let toAmharaKg = 0, toAmharaPeople = 0, toAmharaRev = 0;
  let toAAKg = 0, toAAPeople = 0, toAArev = 0;

  let txt = `*Quick Stats* — ${date}\n`;
  txt += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  txt += `*አዲስ አበባ → አማራ ክልል*\n`;
  for (const ro of ROUTES_TO_AMHARA) {
    const agg = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 }, kg: { $sum: '$weightKg' } } },
    ]);
    const m = {};
    agg.forEach(c => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0);
    const kg     = ['pending','reviewing','approved','sent'].reduce((s, st) => s + (m[st]?.kg || 0), 0);
    const rev    = kg * SHIP_PER_KG;
    toAmharaKg += kg; toAmharaPeople += people; toAmharaRev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n`;
    txt += `   ${people} ሰው | ${kg} ኪ | ፈቃድ: ${m.approved?.n||0} | ፍተሻ: ${m.reviewing?.n||0} | ያልከፈለ: ${m.pending?.n||0} | ተልኳል: ${m.sent?.n||0}\n`;
    txt += `   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }

  txt += `\n*አማራ ክልል → አዲስ አበባ*\n`;
  for (const ro of ROUTES_TO_AA) {
    const agg = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 }, kg: { $sum: '$weightKg' } } },
    ]);
    const m = {};
    agg.forEach(c => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0);
    const kg     = ['pending','reviewing','approved','sent'].reduce((s, st) => s + (m[st]?.kg || 0), 0);
    const rev    = kg * SHIP_PER_KG;
    toAAKg += kg; toAAPeople += people; toAArev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n`;
    txt += `   ${people} ሰው | ${kg} ኪ | ፈቃድ: ${m.approved?.n||0} | ፍተሻ: ${m.reviewing?.n||0} | ያልከፈለ: ${m.pending?.n||0} | ተልኳል: ${m.sent?.n||0}\n`;
    txt += `   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }

  const grandPeople = toAmharaPeople + toAAPeople;
  const grandKg     = toAmharaKg + toAAKg;
  const grandRev    = toAmharaRev + toAArev;
  const grandReg    = grandKg * REG_PER_KG;

  txt += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  txt += `*ጠቅላላ ድምር*\n`;
  txt += `${grandPeople} ሰው | ${grandKg} ኪሎ\n`;
  txt += `ምዝ. ክፍያ: ${grandReg.toLocaleString()} ብር\n`;
  txt += `ጭ. ክፍያ:  ${grandRev.toLocaleString()} ብር\n`;
  txt += `ድምር ገቢ: ${(grandReg + grandRev).toLocaleString()} ብር`;

  await ctx.reply(txt, { parse_mode: 'Markdown' });
});

bot.command('broadcast', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('ፈቃድ የለዎትም');

  const text = ctx.message.text.replace(/^\/broadcast\s*/i, '').trim();
  if (!text) return ctx.reply('አጠቃቀም: /broadcast መልዕክት');

  const users = await Reg.distinct('userId', { status: { $nin: ['rejected'] } });
  let sent = 0, failed = 0;
  for (const uid of users) {
    try {
      await bot.telegram.sendMessage(uid, `${text}\n\n${SUPPORT_PHONE}`, { parse_mode: 'Markdown' });
      sent++;
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await ctx.reply(`ተልኳል: ${sent} | አልደረሳቸውም: ${failed}`);
});

/* ────────────────────────────────────────────────────────────
   21. LAUNCH
   ──────────────────────────────────────────────────────────── */

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await mongoose.connect(MONGO_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
  console.log('MongoDB connected');

  await new Promise(resolve => {
    http.createServer((_, res) => { res.writeHead(200); res.end('OK'); })
      .listen(PORT, () => { console.log('Port', PORT); resolve(); });
  });

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('Webhook deleted');
  } catch (e) {
    console.warn('deleteWebhook:', e.message);
  }

  const RURL = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (RURL) {
    const https = require('https');
    setInterval(() => {
      try {
        const u = new URL(RURL);
        https.request({ hostname: u.hostname, path: '/', method: 'GET' }, r => console.log('keep-alive', r.statusCode)).on('error', () => {}).end();
      } catch {}
    }, 9 * 60 * 1000);
    console.log('Keep-alive started');
  }

  startDailyReportScheduler();
  await bot.launch({ dropPendingUpdates: true });
  console.log('Bot started');

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
