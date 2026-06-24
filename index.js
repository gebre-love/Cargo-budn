'use strict';

const { Telegraf, Markup } = require('telegraf');
const mongoose             = require('mongoose');
const Anthropic            = require('@anthropic-ai/sdk');
const http                 = require('http');

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════
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

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ BOT_TOKEN እና MONGO_URI ያስፈልጋሉ');
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ══════════════════════════════════════════════════════════
//  መስመሮች እና ክፍያ መንገዶች
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
//  DATABASE MODELS
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
//  SESSION
// ══════════════════════════════════════════════════════════
async function getSession(key) {
  try {
    const d = await Session.findOne({ key }).lean();
    return d?.data || {};
  } catch { return {}; }
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

// ══════════════════════════════════════════════════════════
//  RATE LIMIT (ደህንነት)
// ══════════════════════════════════════════════════════════
const rateLimitMap = new Map();
function isRateLimited(userId, limit = 20) {
  const now   = Date.now();
  const entry = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60_000; }
  entry.count++;
  rateLimitMap.set(userId, entry);
  return entry.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) if (now > v.reset) rateLimitMap.delete(k);
}, 5 * 60_000);

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);

const STATUS_LABEL = {
  pending:   '⏳ ክፍያ ይጠብቃል',
  reviewing: '🔍 ክፍያ እየተፈተሸ ነው',
  approved:  '✅ ክፍያ ተፈቅዷል',
  rejected:  '❌ ክፍያ አልተቀበለም',
  sent:      '🚚 ጭነቱ ተልኳል',
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId);
  const me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 ${r.fullName}\n` +
    `📞 ${r.phone}\n` +
    `📦 ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `💳 ${me?.label || '—'}\n` +
    `📍 ${r.locationLat
      ? `[ካርታ ይክፈቱ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})`
      : 'አድራሻ አልተላከም'}\n` +
    `📊 ${STATUS_LABEL[r.status]}`;
  if (r.aiAutoApproved) t += ' 🤖';
  if (admin) t += `\nID: \`${r.userId}\`${r.username ? ' @' + r.username : ''}`;
  return t;
}

const mainKb = () => Markup.keyboard([
  ...ROUTES.map(r => [`${r.emoji} ${r.label}`]),
  ['📋 የምዝገባ ሁኔታ', '📊 ቆጣሪ'],
  ...(ADMIN_IDS.length ? [['🔧 Admin']] : []),
]).resize();

const locKb = () => Markup.keyboard([
  [Markup.button.locationRequest('📍 አሁን ያለሁበትን አድራሻ ላክ')],
  ['⏭️ አድራሻ ሳላጋራ ጨርስ'],
]).resize().oneTime();

const approveKb = id => Markup.inlineKeyboard([[
  Markup.button.callback('✅ ፈቀድ',  `ok_${id}`),
  Markup.button.callback('❌ ከልክል', `no_${id}`),
]]);

function capBox(total, target) {
  const pct    = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10);
  const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return (
    `${bar} ${pct}%\n` +
    `📦 የተመዘገበ: *${total}* ኪሎ\n` +
    `⏳ ቀሪ: *${Math.max(0, target - total)}* ኪሎ\n` +
    `🎯 ኢላማ: *${target}* ኪሎ`
  );
}

// Markdown special chars escape
function esc(text) {
  return String(text || '—').replace(/[_*[\]()~`>#+=|{}.!-]/g, c => '\\' + c);
}

// ══════════════════════════════════════════════════════════
//  ቆጣሪ / CAPACITY
// ══════════════════════════════════════════════════════════
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
        `✅ *${ro.label}*\n\n🎉 ጭነቱ ሞልቷል! (${total}/${ro.targetKg} ኪሎ)\n\n` +
        `🏠 ሠራተኞቻችን ቤትዎ ድረስ ሊሰበስቡ ይመጣሉ — ዝግጁ ይሁኑ!\n\n❓ ለጥያቄ: ${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid,
        `📊 ${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ | ${members.length} ሰው`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    if (CHANNEL_ID) {
      bot.telegram.sendMessage(CHANNEL_ID,
        `📢 *${ro.label}*\n\n🚛 ጭነቱ ሞልቶ ዝግጁ ሆነ!\n\n${capBox(total, ro.targetKg)}\n\n📦 *የጋራ ጭነት* — ርካሽ እና ፈጣን!\n❓ ${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

// ══════════════════════════════════════════════════════════
//  AI ክፍያ ማረጋገጫ
// ══════════════════════════════════════════════════════════
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
  } catch (e) { console.error('AI error:', e.message); return null; }
}

const aiOk = r => r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === 'high';
function aiSummary(r) {
  if (!r) return '🤖 AI ማረጋገጫ አልተሳካም';
  return `🤖 ${aiOk(r) ? '✅ ትክክለኛ' : r?.looks_edited ? '⚠️ ሊደናቀፍ ይችላል' : '❌ ያልተሳካ'} (${r.confidence})\n${r.reason || ''}`;
}

// ══════════════════════════════════════════════════════════
//  ፕሪንት ዝርዝር (በደንብ የተደረደረ)
// ══════════════════════════════════════════════════════════
const PRINT_STATUS_ORDER  = ['approved', 'reviewing', 'pending', 'sent'];
const PRINT_STATUS_HEADER = {
  approved:  '✅ ፈቃድ ያላቸው',
  reviewing: '🔍 እየተፈተሸ ያለ',
  pending:   '⏳ ክፍያ ያልከፈሉ',
  sent:      '🚚 ጭነት የተላከ',
};

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) { await ctx.reply('❗ መስመር አልተገኘም'); return; }

  try {
    const list = await Reg.find({ routeId, status: { $ne: 'rejected' } })
      .sort({ createdAt: 1 }).lean();

    if (!list.length) {
      return ctx.reply(`${ro.emoji} *${ro.label}*\n\n📭 ምዝገባ የለም።`, { parse_mode: 'Markdown' });
    }

    const totalKg     = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    const totalReg    = list.reduce((s, r) => s + (r.weightKg || 0) * REG_PER_KG, 0);
    const totalShip   = list.reduce((s, r) => s + (r.weightKg || 0) * SHIP_PER_KG, 0);
    const approvedCnt = list.filter(r => r.status === 'approved').length;
    const reviewCnt   = list.filter(r => r.status === 'reviewing').length;
    const pendingCnt  = list.filter(r => r.status === 'pending').length;
    const sentCnt     = list.filter(r => r.status === 'sent').length;
    const totalActive = await routeWeight(routeId);
    const now = new Date().toLocaleDateString('am-ET', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── ርዕስ (Header) ──
    await ctx.reply(
      `🖨️ *ፕሪንት ዝርዝር*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${ro.emoji} *${ro.label}*\n` +
      `📅 ${now}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 ጠቅላላ ሰው:       *${list.length}*\n` +
      `⚖️ ጠቅላላ ኪሎ:       *${totalKg} ኪሎ*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ ፈቃድ ያላቸው:    *${approvedCnt}* ሰው\n` +
      `🔍 እየተፈተሸ ያለ:  *${reviewCnt}* ሰው\n` +
      `⏳ ክፍያ ያልከፈሉ:  *${pendingCnt}* ሰው\n` +
      `🚚 ጭነት የተላከ:    *${sentCnt}* ሰው\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 ምዝገባ ክፍያ (${REG_PER_KG}ብ/ኪ):  *${totalReg.toLocaleString('en')} ብር*\n` +
      `🚛 የጭነት ክፍያ (${SHIP_PER_KG}ብ/ኪ): *${totalShip.toLocaleString('en')} ብር*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${capBox(totalActive, ro.targetKg)}`,
      { parse_mode: 'Markdown' }
    );

    // ── ዝርዝር በሁኔታ ቡድን ──
    let idx = 1;

    for (const statusKey of PRINT_STATUS_ORDER) {
      const members = list.filter(r => r.status === statusKey);
      if (!members.length) continue;

      const grpKg   = members.reduce((s, r) => s + (r.weightKg || 0), 0);
      const grpReg  = members.reduce((s, r) => s + (r.weightKg || 0) * REG_PER_KG, 0);
      const grpShip = members.reduce((s, r) => s + (r.weightKg || 0) * SHIP_PER_KG, 0);

      // የቡድን ርዕስ
      await ctx.reply(
        `${PRINT_STATUS_HEADER[statusKey]}\n` +
        `👥 ${members.length} ሰው  |  ⚖️ ${grpKg} ኪሎ\n` +
        `💵 ምዝ: ${grpReg.toLocaleString('en')}ብ  🚛 ጭ: ${grpShip.toLocaleString('en')}ብ\n` +
        `─────────────────────`,
        { parse_mode: 'Markdown' }
      );

      // ሰዎቹ — per 15 batch
      for (let i = 0; i < members.length; i += 15) {
        let rows = '';
        for (const r of members.slice(i, i + 15)) {
          const locLink = r.locationLat
            ? `[📍 ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})`
            : '📍 አድራሻ የለም';
          const regFee  = ((r.weightKg || 0) * REG_PER_KG).toLocaleString('en');
          const shipFee = ((r.weightKg || 0) * SHIP_PER_KG).toLocaleString('en');
          rows +=
            `*${idx++}.* 👤 ${esc(r.fullName)}\n` +
            `     📞 ${r.phone || '—'}\n` +
            `     📦 ${esc(r.cargoDesc)} — *${r.weightKg} ኪሎ*\n` +
            `     💵 ምዝ: ${regFee}ብ  🚛 ጭ: ${shipFee}ብ\n` +
            `     ${locLink}\n` +
            `     ─────────────────\n`;
        }
        await ctx.reply(rows.trim(), {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        });
      }
    }

    // ── ማጠቃለያ (Footer) ──
    await ctx.reply(
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *ማጠቃለያ — ${ro.label}*\n` +
      `👥 ጠቅላላ: *${list.length}* ሰው  ⚖️ *${totalKg}* ኪሎ\n` +
      `✅${approvedCnt}  🔍${reviewCnt}  ⏳${pendingCnt}  🚚${sentCnt}\n` +
      `💵 ምዝ ብር: *${totalReg.toLocaleString('en')}*\n` +
      `🚛 ጭ ብር:  *${totalShip.toLocaleString('en')}*\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );

  } catch (e) {
    await ctx.reply(`❌ ስህተት: ${e.message || 'unknown'}`);
  }
}

// ══════════════════════════════════════════════════════════
//  ዕለታዊ 7 ጠ.ቀ ሪፖርት (DAILY MORNING REPORT)
// ══════════════════════════════════════════════════════════
async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;
  const now  = new Date().toLocaleDateString('am-ET', { year: 'numeric', month: 'long', day: 'numeric' });
  let txt =
    `🌄 *ዕለታዊ ሪፖርት*\n` +
    `📅 ${now}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  let grandTotal = 0, grandPeople = 0, grandPending = 0;

  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 }, kg: { $sum: '$weightKg' } } },
    ]);
    const m = {};
    counts.forEach(c => { m[c._id] = { n: c.n, kg: c.kg }; });

    const people  = counts.reduce((s, c) => s + c.n, 0);
    const totalKg = (m.pending?.kg||0) + (m.reviewing?.kg||0) + (m.approved?.kg||0) + (m.sent?.kg||0);
    const pendingN = (m.pending?.n || 0) + (m.reviewing?.n || 0);

    grandTotal   += totalKg;
    grandPeople  += people;
    grandPending += pendingN;

    if (!people) continue;

    txt +=
      `\n${ro.emoji} *${ro.label}*\n` +
      `   👥 ${people} ሰው | ⚖️ ${totalKg} ኪሎ\n` +
      `   ✅${m.approved?.n||0}  🔍${m.reviewing?.n||0}  ⏳${m.pending?.n||0}  🚚${m.sent?.n||0}\n` +
      `   💰 ምዝ: ${(totalKg * REG_PER_KG).toLocaleString('en')} ብር\n`;
  }

  txt +=
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *ጠቅላላ ድምር*\n` +
    `   👥 ${grandPeople} ሰው | ⚖️ ${grandTotal} ኪሎ\n` +
    `   ⏳ ያልተፈቀዱ: ${grandPending} ሰው\n` +
    `   💵 ምዝ ክፍያ: ${(grandTotal * REG_PER_KG).toLocaleString('en')} ብር\n` +
    `   🚛 ጭ ክፍያ:  ${(grandTotal * SHIP_PER_KG).toLocaleString('en')} ብር\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  for (const aid of ADMIN_IDS) {
    bot.telegram.sendMessage(aid, txt, { parse_mode: 'Markdown' }).catch(() => {});
  }
  console.log('📊 Daily report sent at', new Date().toISOString());
}

// ደቂቃ ደቂቃ ጊዜ ይፈትሻል — 7:00 ጠ.ቀ EAT (UTC+3) ሲሆን ሪፖርት ይልካል
function startDailyReportScheduler() {
  let lastSentDate = '';
  setInterval(async () => {
    const now  = new Date();
    // EAT = UTC+3
    const eat  = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const h    = eat.getUTCHours();
    const min  = eat.getUTCMinutes();
    const date = eat.toISOString().slice(0, 10);
    if (h === 7 && min === 0 && lastSentDate !== date) {
      lastSentDate = date;
      await sendDailyReport().catch(e => console.error('Daily report error:', e.message));
    }
  }, 60_000); // every minute
  console.log('✅ Daily report scheduler started (7:00 AM EAT)');
}

// ══════════════════════════════════════════════════════════
//  BOT
// ══════════════════════════════════════════════════════════
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);

// Rate limit middleware
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (uid && !isAdmin(ctx) && isRateLimited(uid)) {
    return ctx.reply('⚠️ ብዙ ጥያቄ — ትንሽ ይጠብቁ።').catch(() => {});
  }
  return next();
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err?.message || err, '| update:', ctx?.updateType);
});

// ──────────────── /start ────────────────
bot.start(async ctx => {
  ctx.session = {};
  await ctx.reply(
    '👋 *እንኳን ደህና መጡ!*\n\n' +
    '🚛 *የጋራ ጭነት አገልግሎት*\n' +
    '_ከአዲስ አበባ ወደ አማራ ክልል_\n\n' +
    '📌 *እንዴት ይሰራል?*\n' +
    '1️⃣ መስመር ይምረጡ\n' +
    '2️⃣ መረጃ ይሙሉ\n' +
    '3️⃣ ምዝገባ ክፍያ ይክፈሉ (10ብር/ኪሎ)\n' +
    '4️⃣ አድራሻዎን ያጋሩ — ቤትዎ ድረስ እንሰበስባለን\n\n' +
    '💰 *የጭነት ክፍያ* (25ብር/ኪሎ) ሲሰበሰብ ብቻ ይከፈላል\n\n' +
    '👇 *መስመር ይምረጡ:*',
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ──────────────── 📊 ቆጣሪ ────────────────
bot.hears('📊 ቆጣሪ', async ctx => {
  ctx.session = {};
  let txt = '📊 *የጭነት መሙያ ሁኔታ*\n━━━━━━━━━━━━━━━━━━\n';
  for (const ro of ROUTES) {
    const total = await routeWeight(ro.id);
    txt += `\n${ro.emoji} *${ro.label}*\n${capBox(total, ro.targetKg)}\n`;
  }
  await ctx.reply(txt, { parse_mode: 'Markdown', ...mainKb() });
});

// ──────────────── 📋 የምዝገባ ሁኔታ ────────────────
bot.hears('📋 የምዝገባ ሁኔታ', async ctx => {
  ctx.session = {};
  const list = await Reg.find({ userId: ctx.from.id, status: { $nin: ['rejected'] } })
    .sort({ createdAt: -1 }).lean();
  if (!list.length) {
    return ctx.reply('📭 *ምዝገባ የለዎትም*\n\n👇 ከታች ያለን መስመር ይምረጡ ምዝገባ ለመጀመር',
      { parse_mode: 'Markdown', ...mainKb() });
  }
  for (const r of list) {
    const btns = [];
    if (r.status !== 'sent') btns.push(Markup.button.callback('🗑️ ሰርዝ', `del_${r._id}`));
    if (!r.locationLat && r.status !== 'sent') btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode: 'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}) });
  }
});

// ──────────────── አድራሻ ኋላ ጨምር ────────────────
bot.action(/^addloc_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply(
    '📍 *አድራሻ ላክ*\n\nሠራተኞቻችን እቃዎን ሊሰበስቡ ቤትዎ ይመጣሉ።\nቤትዎ አጠገብ ቆሞ 👇 ቁልፉን ይጫኑ:',
    { parse_mode: 'Markdown', ...locKb() }
  );
});

// ──────────────── መስመሮች ────────────────
ROUTES.forEach(route => {
  bot.hears(`${route.emoji} ${route.label}`, async ctx => {
    const ex = await Reg.findOne({
      userId: ctx.from.id, routeId: route.id, status: { $nin: ['rejected', 'sent'] }
    }).lean();
    if (ex) {
      const btns = [Markup.button.callback('🗑️ ሰርዝ', `del_${ex._id}`)];
      if (!ex.locationLat) btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${ex._id}`));
      btns.push(Markup.button.callback('➕ ሌላ እቃ ምዝገባ', `more_${route.id}`));
      return ctx.reply(card(ex) + '\n\n_ቀደም ሲል ተመዝግበዋል_',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([btns]) });
    }
    ctx.session = { step: 'NAME', routeId: route.id, d: {} };
    await ctx.reply(
      `${route.emoji} *${route.label}*\n\n*ደረጃ 1/4* — ሙሉ ስምዎን ያስገቡ\n_ለምሳሌ: አበበ ከበደ_`,
      { parse_mode: 'Markdown', ...mainKb() }
    );
  });
});

bot.action(/^more_([a-z_]+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  ctx.session = { step: 'NAME', routeId: route.id, d: {} };
  await ctx.reply(
    `${route.emoji} *${route.label}* — ➕ ሌላ እቃ ምዝገባ\n\n*ደረጃ 1/4* — ሙሉ ስምዎን ያስገቡ:`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ──────────────── ክፍያ method ────────────────
bot.action(/^pm_(.+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'PAYMETHOD') return;
  const m = byMethod(ctx.match[1]);
  if (!m) return;
  const { d, routeId } = ctx.session;
  ctx.session = {};
  const r = await Reg.create({
    userId: ctx.from.id, username: ctx.from.username || '',
    fullName: d.name, phone: d.phone,
    routeId, cargoDesc: d.cargo, weightKg: d.kg,
    totalPrice: d.kg * REG_PER_KG,
    paymentMethod: m.id, status: 'pending',
  });
  await checkCapacity(routeId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const acct = m.info.includes(':') ? m.info.split(':').slice(1).join(':').trim() : m.info;
  await ctx.reply(
    `💳 *${r.totalPrice} ብር ይክፈሉ*\n\n` +
    `${m.emoji} *${m.label}*\n📋 ቁጥር: \`${acct}\`\n\n` +
    `✅ ከፍለው ከጨረሱ:\n📸 *የክፍያ ደረሰኝ ፎቶ ይላኩ* (screenshot ወይም ፎቶ)`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ──────────────── TEXT flow ────────────────
bot.on('text', async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();
  const reserved = [
    '📋 የምዝገባ ሁኔታ', '📊 ቆጣሪ', '🔧 Admin', '⏭️ አድራሻ ሳላጋራ ጨርስ',
    ...ROUTES.map(r => `${r.emoji} ${r.label}`),
  ];
  if (reserved.includes(txt)) return next();

  if (step === 'PAYMETHOD') return ctx.reply('👆 ከላይ ያለውን ቁልፍ ይምረጡ');

  if (step === 'NAME') {
    if (txt.length < 3) return ctx.reply('⚠️ ሙሉ ስምዎን ያስገቡ (ቢያንስ 3 ፊደል)');
    ctx.session.d.name = txt;
    ctx.session.step   = 'PHONE';
    return ctx.reply('*ደረጃ 2/4* — ስልክ ቁጥርዎን ያስገቡ\n_ለምሳሌ: 0912345678_', { parse_mode: 'Markdown' });
  }
  if (step === 'PHONE') {
    const phone = txt.replace(/\s/g, '');
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone)) {
      return ctx.reply('⚠️ ትክክለኛ ስልክ ቁጥር ያስገቡ\n_ለምሳሌ: 0912345678 ወይም 0712345678_', { parse_mode: 'Markdown' });
    }
    ctx.session.d.phone = phone;
    ctx.session.step    = 'CARGO';
    return ctx.reply('*ደረጃ 3/4* — ጭነት ዓይነት ያስገቡ\n_ለምሳሌ: ልብስ, ምግብ, ቦርሳ_', { parse_mode: 'Markdown' });
  }
  if (step === 'CARGO') {
    ctx.session.d.cargo = txt;
    ctx.session.step    = 'WEIGHT';
    return ctx.reply('*ደረጃ 4/4* — ክብደት ያስገቡ (ኪሎ)\n_ለምሳሌ: 50_', { parse_mode: 'Markdown' });
  }
  if (step === 'WEIGHT') {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ''));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ (1–2000)\n_ለምሳሌ: 50_', { parse_mode: 'Markdown' });
    ctx.session.d.kg = kg;
    ctx.session.step = 'PAYMETHOD';
    return ctx.reply(
      `📋 *ማጠቃለያ*\n━━━━━━━━━━━━\n` +
      `👤 ${ctx.session.d.name}\n📦 ${ctx.session.d.cargo} — ${kg} ኪሎ\n` +
      `💰 ምዝገባ ክፍያ: *${kg * REG_PER_KG} ብር*\n` +
      `💰 የጭነት ክፍያ: ${kg * SHIP_PER_KG} ብር _(ሲሰበሰብ)_\n\n💳 *ክፍያ መንገድ ይምረጡ:*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(METHODS.map(m => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)])) }
    );
  }
  if (step === 'LOC') {
    ctx.session.locTries = (ctx.session.locTries || 0) + 1;
    if (ctx.session.locTries >= 3) return ctx.reply(`📍 ቁልፉን ይጫኑ\nችግር ካለ: ❓ ${SUPPORT_PHONE}`, locKb());
    return ctx.reply('📍 ጽሁፍ ሳይሆን 👇 *"አሁን ያለሁበትን አድራሻ ላክ"* ቁልፍ ይጫኑ', { parse_mode: 'Markdown', ...locKb() });
  }
  if (step === 'SEND_NOTE') {
    if (!isAdmin(ctx)) { ctx.session = {}; return next(); }
    const ro = byRoute(ctx.session.sendRoute);
    ctx.session = {};
    const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
    if (!ready.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ የለም።', mainKb());
    await Reg.updateMany({ _id: { $in: ready.map(r => r._id) } }, { status: 'sent' });
    let sent = 0;
    for (const r of ready) {
      try {
        await bot.telegram.sendMessage(r.userId,
          `🚚 *ጭነትዎ ተልኳል!*\n\n${byRoute(r.routeId)?.emoji} ${byRoute(r.routeId)?.label}\n\n📋 ${txt}\n\n❓ ለጥያቄ: ${SUPPORT_PHONE}`,
          { parse_mode: 'Markdown' });
        sent++;
      } catch {}
    }
    return ctx.reply(`✅ ተልኳል — ${ready.length} ሰው (${sent} ደርሷቸዋል)`, mainKb());
  }
  return next();
});

// ──────────────── LOCATION ────────────────
bot.on('location', async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude: lat, longitude: lng } = ctx.message.location;

  if (step === 'COL_LOC' && isAdmin(ctx)) {
    const ro   = byRoute(ctx.session.colRoute);
    ctx.session = {};
    const list  = await Reg.find({ routeId: ro?.id, status: { $in: ACTIVE } }).lean();
    if (!list.length) return ctx.reply(`📭 ${ro?.label} — ምዝገባ የለም።`, mainKb());
    function km(a1, o1, a2, o2) {
      const R = 6371, da = (a2-a1)*Math.PI/180, dl = (o2-o1)*Math.PI/180;
      const x = Math.sin(da/2)**2 + Math.cos(a1*Math.PI/180)*Math.cos(a2*Math.PI/180)*Math.sin(dl/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    }
    const sorted = list
      .map(r => ({ ...r, dist: r.locationLat ? km(lat, lng, r.locationLat, r.locationLng) : 9999 }))
      .sort((a, b) => a.dist - b.dist);
    await ctx.reply(`🗺️ *${ro?.label}* — ${sorted.length} ሰው (ከቅርብ ወደ ሩቅ)`, { parse_mode: 'Markdown' });
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      await ctx.reply(
        `*${i+1}.* ${r.fullName} | 📞 ${r.phone} | ${r.weightKg}ኪሎ\n` +
        (r.dist < 9999 ? `📏 ${r.dist.toFixed(1)} ኪሜ` : '📍 አድራሻ አልተላከም'),
        { parse_mode: 'Markdown' }
      );
      if (r.locationLat) await bot.telegram.sendLocation(ctx.chat.id, r.locationLat, r.locationLng).catch(() => {});
    }
    return;
  }

  if (step === 'LOC') {
    const regId = ctx.session.locRegId;
    ctx.session = {};
    const r = await Reg.findByIdAndUpdate(regId, { locationLat: lat, locationLng: lng }, { new: true });
    if (!r) return ctx.reply('❗ ምዝገባ አልተገኘም።', mainKb());
    const total = await routeWeight(r.routeId);
    const ro2   = byRoute(r.routeId);
    await ctx.reply(
      '✅ *ምዝገባ ተጠናቀቀ!*\n\n🏠 ጭነቱ ሲሞላ ሠራተኞቻችን ቤትዎ ድረስ ይሰበስቡዎታል\n\n' +
      `${ro2?.emoji} ${ro2?.label}\n${capBox(total, ro2?.targetKg || TARGET_KG_DEFAULT)}\n\n❓ ለጥያቄ: ${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown', ...mainKb() }
    );
    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid, `📍 አድራሻ ደርሷል — ${r.fullName} (${r.phone}) → ${ro2?.label}`, { parse_mode: 'Markdown' }).catch(() => {});
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }
  return next();
});

bot.hears('⏭️ አድራሻ ሳላጋራ ጨርስ', async ctx => {
  if (ctx.session?.step !== 'LOC') return ctx.reply('👇 መስመር ይምረጡ።', mainKb());
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply(
    `✅ *ምዝገባ ተጠናቀቀ!*\n\n📌 አድራሻ ኋላ ለመጨምር:\n"📋 የምዝገባ ሁኔታ" → "📍 አድራሻ ላክ"\n\n❓ ለጥያቄ: ${SUPPORT_PHONE}`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r) for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, `⚠️ አድራሻ አልተላከም — ${r.fullName} (${r.phone})`).catch(() => {});
  }
});

// ──────────────── PHOTO ────────────────
bot.on('photo', async ctx => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: 'pending' }).sort({ createdAt: -1 });
  if (!r) return ctx.reply('⚠️ ምዝገባ አልተገኘም። 👇 መስመር ይምረጡ።', mainKb());
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = 'reviewing';
  await r.save();
  await ctx.reply('📸 ፎቶ ደርሷል! ⏳ ክፍያ እየተረጋገጠ ነው…');
  const verdict = await checkPayment(fileId, r);
  r.aiVerdict   = verdict;
  const autoOk  = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) { r.status = 'approved'; r.aiAutoApproved = true; }
  await r.save();
  bot.telegram.sendMessage(ctx.from.id,
    autoOk
      ? `✅ *ክፍያዎ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል ❓ ${SUPPORT_PHONE}`
      : `✅ *ፎቶ ደርሷል*\n\n${card(r.toObject())}\n\nክፍያ እየተፈተሸ ነው — ትንሽ ይጠብቁ ❓ ${SUPPORT_PHONE}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply(
    '📍 *የሚሰበሰቡበት አድራሻ ያጋሩ*\n\n' +
    'ሠራተኞቻችን እቃዎን ሊሰበስቡ ቤትዎ ይመጣሉ!\n' +
    'ቤትዎ አጠገብ ቆሞ 👇 *"አሁን ያለሁበትን አድራሻ ላክ"* ቁልፍ ይጫኑ\n\n' +
    '_(ቁልፉ አድራሻዎን በካርታ ያሳያል — ጽሁፍ አያስፈልግም)_',
    { parse_mode: 'Markdown', ...locKb() }
  );
  const caption  = aiSummary(verdict) + '\n\n' + (autoOk ? '✅ AI ያረጋገጠ\n\n' : '') + card(r.toObject(), true);
  const adminKbInline = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk ? '↩️ ሰርዝ' : '✅ ፈቀድ', autoOk ? `no_${r._id}` : `ok_${r._id}`),
    Markup.button.callback('❌ ከልክል', `no_${r._id}`),
  ]]);
  for (const aid of ADMIN_IDS) {
    bot.telegram.sendPhoto(aid, fileId, { caption, parse_mode: 'Markdown', ...adminKbInline }).catch(() => {});
  }
});

// ──────────────── 🔧 Admin ────────────────
bot.hears('🔧 Admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  ctx.session = {};
  await ctx.reply('🔧 *Admin Panel*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    ...ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)]),
    [Markup.button.callback('🔍 ያልተፈቀዱ ክፍያዎች', 'lst_pay')],
    [Markup.button.callback('🗺️ ሰብሳቢ ዝርዝር',     'col_pick')],
    [Markup.button.callback('🚚 ጭነት ላክ',          'snd_pick')],
    [Markup.button.callback('📊 ሪፖርት',             'report')],
    [Markup.button.callback('📢 ቻናል',              'channel_panel')],
    [Markup.button.callback('🖨️ ፕሪንት ዝርዝር',       'print_pick')],
  ]) });
});

bot.action(/^lst_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const list = await Reg.find({ routeId: ro.id }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም።`);
  const cnt = {};
  list.forEach(r => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const total = await routeWeight(ro.id);
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\nጠቅላላ: ${list.length} | ⏳${cnt.pending||0} 🔍${cnt.reviewing||0} ✅${cnt.approved||0} 🚚${cnt.sent||0}\n\n${capBox(total, ro.targetKg)}`,
    { parse_mode: 'Markdown' }
  );
  for (const r of list) {
    const kb = r.status === 'reviewing' ? approveKb(r._id)
      : r.status === 'approved' ? Markup.inlineKeyboard([[Markup.button.callback('❌ ሰርዝ', `no_${r._id}`)]])
      : {};
    await ctx.reply(card(r, true), { parse_mode: 'Markdown', ...kb });
  }
});

bot.action('lst_pay', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const list = await Reg.find({ status: 'reviewing' }).sort({ createdAt: 1 }).lean();
  if (!list.length) return ctx.reply('✅ ያልተፈቀደ ክፍያ የለም።');
  for (const r of list) {
    const txt = aiSummary(r.aiVerdict) + '\n\n' + card(r, true);
    if (r.paymentFileId) {
      await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: 'Markdown', ...approveKb(r._id) });
    } else {
      await ctx.reply(txt, { parse_mode: 'Markdown', ...approveKb(r._id) });
    }
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status: newStatus }, { new: true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx[fn](card(r.toObject(), true), { parse_mode: 'Markdown' }).catch(() => {});
  if (notifyFn) bot.telegram.sendMessage(r.userId, notifyFn(r), { parse_mode: 'Markdown' }).catch(() => {});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery('✅').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'approved', r =>
    `✅ *ክፍያዎ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል ❓ ${SUPPORT_PHONE}`
  );
});

bot.action(/^no_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery('❌').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'rejected', () =>
    `❌ ክፍያዎ አልተቀበለም\n\nለእርዳታ: ❓ ${SUPPORT_PHONE}`
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === 'sent') return ctx.reply('⚠️ ጭነቱ ቀድሞ ተልኳል — መሰረዝ አይቻልም።');
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply('🗑️ ምዝገባ ተሰርዟል\n\n👇 ለመመዝገብ መስመር ይምረጡ', mainKb());
});

bot.action('snd_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🚚 *ምን መስመር?*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])) });
});

bot.action(/^snd_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro    = byRoute(ctx.match[1]);
  const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
  if (!ready.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ የለም።');
  const total = ready.reduce((s, r) => s + (r.weightKg || 0), 0);
  ctx.session = { step: 'SEND_NOTE', sendRoute: ro?.id };
  await ctx.reply(
    `🚚 *${ro?.label}*\n👥 ${ready.length} ሰው | ⚖️ ${total} ኪሎ\n\n📝 ለደንበኛ የሚሄድ ማስታወሻ ያስገቡ:\n_ለምሳሌ: ሲኖትራክ — ሰኞ ጠዋት 6:00_`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('report', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = '📊 *ሪፖርት*\n━━━━━━━━━━━━━━━━━━\n';
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const m = {};
    counts.forEach(c => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `\n${ro.emoji} *${ro.label}*\n⏳${m.pending||0} 🔍${m.reviewing||0} ✅${m.approved||0} 🚚${m.sent||0} | ${total}/${ro.targetKg}ኪሎ\n`;
  }
  await ctx.reply(txt, { parse_mode: 'Markdown' });
});

bot.action('col_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🗺️ *መስመር ይምረጡ:*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])) });
});

bot.action(/^col_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: 'COL_LOC', colRoute: ctx.match[1] };
  await ctx.reply('📍 *ያሉበትን ቦታ ያጋሩ*\n\nሠራተኞቹ ከቅርብ ወደ ሩቅ ይደረደራሉ 👇', { parse_mode: 'Markdown', ...locKb() });
});

// ──────────────── 🖨️ ፕሪንት ────────────────
bot.action('print_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🖨️ *የትኛው መስመር?*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])) });
});

bot.action(/^prnt_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await handlePrint(ctx, ctx.match[1]);
});

// ──────────────── 📢 ቻናል ────────────────
bot.action('channel_panel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const connected = CHANNEL_ID ? `✅ \`${CHANNEL_ID}\`` : '❌ CHANNEL_ID አልተቀመጠም';
  await ctx.reply(`📢 *ቻናል*\n${connected}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback('🧪 ፍተሻ ላክ', 'ch_test')],
    ...ROUTES.map(r => [Markup.button.callback(`📣 ${r.emoji} ${r.label}`, `ch_ann_${r.id}`)]),
  ]) });
});

bot.action('ch_test', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply('❌ CHANNEL_ID አልተቀመጠም።');
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, '🧪 ፍተሻ — ቦቱ ወደ ቻናሉ ደርሷል ✅');
    await ctx.reply('✅ ተሳክቷል!');
  } catch (e) { await ctx.reply(`❌ አልተሳካም: ${e.message}\n\nቦቱ የቻናሉ admin መሆኑን ያረጋግጡ።`); }
});

bot.action(/^ch_ann_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply('❌ CHANNEL_ID አልተቀመጠም።');
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);
  try {
    await bot.telegram.sendMessage(CHANNEL_ID,
      `📢 *${ro.label}*\n\n${capBox(total, ro.targetKg)}\n\n📦 *የጋራ ጭነት* — ርካሽ እና ፈጣን!\n❓ ${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown' });
    await ctx.reply(`✅ ማስታወቂያ ተልኳል — ${ro.label}`);
  } catch (e) { await ctx.reply(`❌ አልተሳካም: ${e.message}`); }
});

// Catch-all callback
// /report_now — admin ወዲያው ሪፖርት ለማስተላለፍ
bot.command('report_now', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  await ctx.reply('⏳ ሪፖርት እየተሰናዳ ነው…');
  await sendDailyReport();
  await ctx.reply('✅ ሪፖርት ለሁሉም Admin ተልኳል!');
});

// /broadcast — ለሁሉም ምዝገቦዎች መልዕክት ላክ
// አጠቃቀም: /broadcast ሲኖትራክ ሰኞ ጠዋት 6:00 ነዎ
bot.command('broadcast', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, '').trim();
  if (!text) {
    return ctx.reply(
      '📢 *Broadcast አጠቃቀም:*\n\n`/broadcast ለዚህ ደንበኞቼ ሁሉ የምልካቸው መልዕክት`\n\n_ለምሳሌ:_\n`/broadcast ሲኖትራክ ሰኞ ጠዋት 6:00 ዝግጁ ነዎ — ሁሉም Approved ደንበኞቻችን ጭነትዎ ይሰበሰባል!`',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply(`⏳ ለሁሉም ደንበኞቼ "${text.slice(0,40)}…" እየተላከ ነው…`);

  // ሁሉንም active ምዝገቦዎቻቸው (rejected ሳይሆኑ) ያዩ
  const users = await Reg.distinct('userId', { status: { $nin: ['rejected'] } });
  let sent = 0, failed = 0;
  for (const uid of users) {
    try {
      await bot.telegram.sendMessage(uid,
        `📢 *ማስታወቂያ*\n\n${text}\n\n❓ ለጥያቄ: ${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      );
      sent++;
    } catch { failed++; }
    // Rate limit — Telegram allows ~30 msg/sec
    await new Promise(r => setTimeout(r, 50));
  }
  await ctx.reply(
    `✅ *Broadcast ተጠናቀቀ!*\n\n` +
    `📨 ደርሷቸዋል: ${sent} ሰው\n` +
    `❌ አልደረሳቸውም: ${failed} (Bot ያለቆረጡ ካቆሙ)`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery('⚠️ ጊዜው አልፏል — /start ይሞክሩ').catch(() => {});
});

// ══════════════════════════════════════════════════════════
//  LAUNCH — Long Polling Only (Render 24/7)
// ══════════════════════════════════════════════════════════
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // 1. MongoDB
  await mongoose.connect(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  console.log('✅ MongoDB connected');

  // 2. HTTP health-check server — Render port scan ሲያካሂድ ዝግጁ ይሆናል
  await new Promise(resolve => {
    http.createServer((_, res) => { res.writeHead(200); res.end('OK'); })
      .listen(PORT, () => { console.log('✅ Health server port', PORT); resolve(); });
  });

  // 3. Webhook ሰርዝ — 409 Conflict እና double-delivery እንዳይፈጠር
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Webhook deleted — using long polling');
  } catch (e) {
    console.warn('⚠️ deleteWebhook:', e.message);
  }

  // 4. Keep-alive ping — Render free tier ከ50s spin-down ለማምለጥ
  const RURL = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (RURL) {
    const https = require('https');
    setInterval(() => {
      try {
        const u = new URL(RURL);
        https.request({ hostname: u.hostname, path: '/', method: 'GET' },
          r => console.log('🔄 keep-alive', r.statusCode)
        ).on('error', () => {}).end();
      } catch {}
    }, 9 * 60 * 1000); // every 9 minutes
    console.log('✅ Keep-alive ping started');
  }

  // 5. Daily report scheduler
  startDailyReportScheduler();

  // 6. Long polling
  await bot.launch({ dropPendingUpdates: true });
  console.log('✅ Bot polling started');

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

main().catch(err => { console.error('❌ Startup error:', err.message); process.exit(1); });
