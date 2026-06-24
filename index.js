'use strict';

const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

// ══ CONFIG ════════════════════════════════════════════════
const BOT_TOKEN         = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI         = process.env.MONGO_URI  || '';
const SUPPORT_PHONE     = process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS         = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY || '';
const AI_AUTO_APPROVE   = (process.env.AI_AUTO_APPROVE || 'true') === 'true';
const TARGET_KG_DEFAULT = Number(process.env.TARGET_KG_DEFAULT) || 5000;
const CHANNEL_ID        = (process.env.CHANNEL_ID || '').trim();
const REG_PER_KG        = 10;
const SHIP_PER_KG       = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('BOT_TOKEN እና MONGO_URI ያስፈልጋሉ');
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ══ መስመሮች ═══════════════════════════════════════════════
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
  { id: 'cbe',      emoji: '🏦', label: 'CBE ባንክ', info: process.env.CBE_INFO     || 'CBE: 1000370308447'  },
];

const byRoute  = id => ROUTES.find(r => r.id === id);
const byMethod = id => METHODS.find(m => m.id === id);
const ACTIVE   = ['pending', 'reviewing', 'approved'];

// ══ DB ═══════════════════════════════════════════════════
const Reg = mongoose.model('Reg', new mongoose.Schema({
  userId:        { type: Number, required: true },
  username:      { type: String, default: '' },
  fullName:      String,
  phone:         String,
  routeId:       String,
  cargoDesc:     String,
  weightKg:      { type: Number, default: 0 },
  totalPrice:    { type: Number, default: 0 },
  paymentMethod: { type: String, default: null },
  paymentFileId: { type: String, default: null },
  locationLat:   { type: Number, default: null },
  locationLng:   { type: Number, default: null },
  status:        { type: String, default: 'pending', enum: ['pending','reviewing','approved','rejected','sent'] },
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

// ══ SESSION ══════════════════════════════════════════════
async function getSession(key) {
  try { const d = await Session.findOne({ key }).lean(); return d?.data || {}; } catch { return {}; }
}
async function saveSession(key, data) {
  try { await Session.findOneAndUpdate({ key }, { data, updatedAt: new Date() }, { upsert: true }); } catch {}
}
function sessionMW(ctx, next) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`;
  return getSession(key).then(data => {
    ctx.session = data;
    return next().then(() => saveSession(key, ctx.session));
  });
}

// ══ HELPERS ══════════════════════════════════════════════
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);

const STATUS_LABEL = {
  pending:   '⏳ ክፍያ ይጠብቃል',
  reviewing: '🔍 እየተፈተሸ ነው',
  approved:  '✅ ተፈቅዷል',
  rejected:  '❌ ተከልክሏል',
  sent:      '🚚 ተልኳል',
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId);
  const me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 *${r.fullName}*\n` +
    `📞 ${r.phone}\n` +
    `📦 ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `💰 የምዝገባ ክፍያ: ${r.totalPrice} ብር\n` +
    `💰 የጭነት ክፍያ: ${r.weightKg * SHIP_PER_KG} ብር _(ሲሰበሰብ)_\n` +
    `💳 ${me?.label || '—'}\n` +
    `📍 አድራሻ: ${r.locationLat ? `[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : 'አልተላከም'}\n` +
    `📊 ${STATUS_LABEL[r.status]}`;
  if (r.aiAutoApproved) t += ' 🤖';
  if (admin) t += `\n🔑 \`${r.userId}\`${r.username ? ' @' + r.username : ''}`;
  return t;
}

const mainKb = () => Markup.keyboard([
  ...ROUTES.map(r => [`${r.emoji} ${r.label}`]),
  ['📋 የምዝገባ ሁኔታ', '📊 ቆጣሪ'],
  ...(ADMIN_IDS.length ? [['🔧 Admin']] : []),
]).resize();

const locKb = () => Markup.keyboard([
  [Markup.button.locationRequest('📍 አድራሻዬን አጋራ')],
  ['⏭️ አድራሻ ሳላጋራ ቀጥል'],
]).resize().oneTime();

const approveKb = id => Markup.inlineKeyboard([[
  Markup.button.callback('✅ ፈቀድ',  `ok_${id}`),
  Markup.button.callback('❌ ከልክል', `no_${id}`),
]]);

async function tell(uid, txt) {
  await bot.telegram.sendMessage(uid, txt, { parse_mode: 'Markdown' }).catch(() => {});
}

// ══ ክብደት ቆጣሪ ════════════════════════════════════════════
async function routeWeight(routeId) {
  const res = await Reg.aggregate([
    { $match: { routeId, status: { $in: ACTIVE } } },
    { $group: { _id: null, total: { $sum: '$weightKg' } } },
  ]);
  return res[0]?.total || 0;
}

function capBox(total, target) {
  const pct    = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10);
  const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const remain = Math.max(0, target - total);
  return (
    `${bar} ${pct}%\n` +
    `📦 እስካሁን የተመዘገበ: *${total}* ኪሎ\n` +
    `⏳ ቀሪ: *${remain}* ኪሎ\n` +
    `🎯 ኢላማ: *${target}* ኪሎ`
  );
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
    const msg =
      `🚛 *${ro.label}*\n\n` +
      `✅ ጭነቱ ሞልቷል! (${total}/${ro.targetKg} ኪሎ)\n\n` +
      `🏠 ድርጅታችን ቤትዎ ድረስ ሊሰበስብ ይመጣል — ዝግጁ ይሁኑ!\n\n` +
      `❓ ${SUPPORT_PHONE}`;
    for (const m of members) tell(m.userId, msg);
    for (const aid of ADMIN_IDS) tell(aid, `📊 ${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ (${members.length} ሰው)`);
    if (CHANNEL_ID) {
      bot.telegram.sendMessage(CHANNEL_ID,
        `📢 *${ro.label}*\n\n🚛 ጭነቱ ሞልቶ ዝግጁ ሆነ!\n\n${capBox(total, ro.targetKg)}\n\n📦 የጋራ ጭነት — ርካሽ እና ፈጣን!\n❓ ${SUPPORT_PHONE}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

// ══ AI ═══════════════════════════════════════════════════
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
      model: 'claude-sonnet-4-6', max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text:
          `Payment screenshot. Method:${m?.label} Account:"${m?.info}" Amount:${reg.totalPrice}ETB\n` +
          `Reply ONLY JSON: {"amount_match":bool,"account_match":bool,"looks_edited":bool,"confidence":"high|medium|low","reason":"short amharic"}` },
      ]}],
    });
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) { console.error('AI err:', e.message); return null; }
}

const aiOk = r => r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === 'high';
function aiSummary(r) {
  if (!r) return '🤖 AI ማረጋገጫ አልተሳካም';
  return `🤖 ${aiOk(r) ? '✅ ትክክለኛ' : r?.looks_edited ? '⚠️ ሊደናቀፍ ይችላል' : '❌ ያልተሳካ'} (${r.confidence})\n${r.reason || ''}`;
}

// ══ BOT ══════════════════════════════════════════════════
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);
bot.catch((err, ctx) => {
  console.error('Bot err:', err?.message || err, '| type:', ctx?.updateType);
});

// ══ /start ══════════════════════════════════════════════
bot.start(async ctx => {
  ctx.session = {};
  await ctx.reply(
    '🚚 *እንኳን ደህና መጡ!*\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '📦 *የጋራ ጭነት አገልግሎት*\n' +
    '_አዲስ አበባ ↔ አማራ ክልል_\n\n' +
    '💰 *ምዝገባ ክፍያ:* 10 ብር/ኪሎ _(አሁን)_\n' +
    '🚛 *ጭነት ክፍያ:* 25 ብር/ኪሎ _(ሲሰበሰብ)_\n' +
    '🏠 ቤትዎ ድረስ እንሰበስባለን\n\n' +
    '👇 *መስመር ይምረጡ ምዝገባ ለመጀመር:*',
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ══ ቆጣሪ ═════════════════════════════════════════════════
bot.hears('📊 ቆጣሪ', async ctx => {
  ctx.session = {};
  let txt = '📊 *የጭነት ሁኔታ*\n━━━━━━━━━━━━━━━━━━\n';
  for (const ro of ROUTES) {
    const total = await routeWeight(ro.id);
    txt += `\n${ro.emoji} *${ro.label}*\n${capBox(total, ro.targetKg)}\n`;
  }
  txt += `\n📦 የጋራ ጭነት — ርካሽ እና ፈጣን!\n❓ ${SUPPORT_PHONE}`;
  await ctx.reply(txt, { parse_mode: 'Markdown', ...mainKb() });
});

// ══ የምዝገባ ሁኔታ ══════════════════════════════════════════
bot.hears('📋 የምዝገባ ሁኔታ', async ctx => {
  ctx.session = {};
  const list = await Reg.find({ userId: ctx.from.id, status: { $nin: ['rejected'] } })
    .sort({ createdAt: -1 }).lean();
  if (!list.length) {
    return ctx.reply('📭 ምዝገባ የለዎትም።\n\n👇 መስመር ይምረጡ ለመጀመር!', mainKb());
  }
  for (const r of list) {
    const btns = [];
    if (r.status !== 'sent') btns.push(Markup.button.callback('🗑️ ሰርዝ', `del_${r._id}`));
    if (!r.locationLat && r.status !== 'sent') btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode: 'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}) });
  }
});

// ══ አድራሻ ጨምር ════════════════════════════════════════════
bot.action(/^addloc_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from.id) return;
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('📍 *አድራሻዎን ያጋሩ*\n\n👇 ከታች ያለውን ቁልፍ ይጫኑ', { parse_mode: 'Markdown', ...locKb() });
});

// ══ መስመሮች — ምዝገባ ══════════════════════════════════════
ROUTES.forEach(route => {
  bot.hears(`${route.emoji} ${route.label}`, async ctx => {
    const ex = await Reg.findOne({
      userId: ctx.from.id, routeId: route.id, status: { $nin: ['rejected', 'sent'] }
    }).lean();

    if (ex) {
      const btns = [Markup.button.callback('🗑️ ሰርዝ', `del_${ex._id}`)];
      if (!ex.locationLat) btns.push(Markup.button.callback('📍 አድራሻ ላክ', `addloc_${ex._id}`));
      btns.push(Markup.button.callback('➕ ሌላ እቃ ምዝገባ', `more_${route.id}`));
      return ctx.reply(
        card(ex) + '\n\n_⚠️ ቀደም ሲል ተመዝግበዋል_',
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([btns]) }
      );
    }

    ctx.session = { step: 'NAME', routeId: route.id };
    await ctx.reply(
      `${route.emoji} *${route.label}*\n\n👤 ሙሉ ስምዎን ያስገቡ:\n_ለምሳሌ: አበበ ከበደ_`,
      { parse_mode: 'Markdown', ...mainKb() }
    );
  });
});

// ── ሌላ ምዝገባ ──────────────────────────────────────────────
bot.action(/^more_([a-z_]+)$/, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  ctx.session = { step: 'NAME', routeId: route.id };
  await ctx.reply(
    `${route.emoji} *${route.label}*\n\n➕ ሌላ እቃ ምዝገባ\n\n👤 ሙሉ ስምዎን ያስገቡ:`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ══ ክፍያ method ════════════════════════════════════════════
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
    `${m.emoji} *${m.label}*\n` +
    `📋 \`${acct}\`\n\n` +
    `✅ ከፍለው ከጨረሱ የክፍያ *screenshot* ይላኩ 📸`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ══ TEXT — ምዝገባ flow ════════════════════════════════════
bot.on('text', async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();

  const reserved = [
    '📋 የምዝገባ ሁኔታ', '📊 ቆጣሪ', '🔧 Admin', '⏭️ አድራሻ ሳላጋራ ቀጥል',
    ...ROUTES.map(r => `${r.emoji} ${r.label}`),
  ];
  if (reserved.includes(txt)) return next();

  if (step === 'PAYMETHOD') return ctx.reply('👆 ከላይ ያለውን ቁልፍ ይምረጡ');

  if (step === 'NAME') {
    if (txt.length < 3) return ctx.reply('⚠️ ሙሉ ስም ያስገቡ (ቢያንስ 3 ፊደል)');
    ctx.session.d    = { name: txt };
    ctx.session.step = 'PHONE';
    return ctx.reply('📞 ስልክ ቁጥርዎን ያስገቡ:\n_ለምሳሌ: 0912345678_', { parse_mode: 'Markdown' });
  }
  if (step === 'PHONE') {
    const phone = txt.replace(/\s/g, '');
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone)) {
      return ctx.reply('⚠️ ትክክለኛ ስልክ ቁጥር ያስገቡ\n_ለምሳሌ: 0912345678_', { parse_mode: 'Markdown' });
    }
    ctx.session.d.phone = phone;
    ctx.session.step    = 'CARGO';
    return ctx.reply('📦 ጭነት ዓይነት ያስገቡ:\n_ለምሳሌ: ልብስ, ቦርሳ, ምግብ_', { parse_mode: 'Markdown' });
  }
  if (step === 'CARGO') {
    ctx.session.d.cargo = txt;
    ctx.session.step    = 'WEIGHT';
    return ctx.reply('⚖️ ክብደት ያስገቡ (ኪሎ):\n_ለምሳሌ: 50_', { parse_mode: 'Markdown' });
  }
  if (step === 'WEIGHT') {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ''));
    if (!kg || kg <= 0 || kg > 2000) {
      return ctx.reply('⚠️ ትክክለኛ ክብደት ያስገቡ (1–2000 ኪሎ)');
    }
    ctx.session.d.kg = kg;
    ctx.session.step = 'PAYMETHOD';
    return ctx.reply(
      `📊 *ክፍያ ማጠቃለያ*\n━━━━━━━━━━━━\n` +
      `📦 ${kg} ኪሎ × ${REG_PER_KG}ብር = *${kg * REG_PER_KG} ብር*\n` +
      `_(የጭነት ክፍያ ${SHIP_PER_KG}ብር/ኪሎ ሲሰበሰብ ይከፈላል)_\n\n` +
      `💳 *ክፍያ መንገድ ይምረጡ:*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(METHODS.map(m => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)])),
      }
    );
  }
  if (step === 'LOC') {
    ctx.session.locTries = (ctx.session.locTries || 0) + 1;
    if (ctx.session.locTries >= 3) return ctx.reply(`📍 ቁልፍ ይጫኑ ወይም ⏭️ ቀጥሉ\n❓ ${SUPPORT_PHONE}`, locKb());
    return ctx.reply('📍 ጽሁፍ ሳይሆን 👇 ቁልፉን ይጫኑ', locKb());
  }
  if (step === 'SEND_NOTE') {
    if (!isAdmin(ctx)) { ctx.session = {}; return next(); }
    const ro    = byRoute(ctx.session.sendRoute);
    ctx.session = {};
    const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
    if (!ready.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ የለም።', mainKb());
    await Reg.updateMany({ _id: { $in: ready.map(r => r._id) } }, { status: 'sent' });
    let sent = 0;
    for (const r of ready) {
      try {
        await bot.telegram.sendMessage(r.userId,
          `🚚 *ጭነትዎ ተልኳል!*\n\n${byRoute(r.routeId)?.emoji} ${byRoute(r.routeId)?.label}\n\n📋 ${txt}\n\n❓ ${SUPPORT_PHONE}`,
          { parse_mode: 'Markdown' }
        );
        sent++;
      } catch {}
    }
    return ctx.reply(`✅ ${ready.length} ሰው ተልኳቸዋል (${sent} ደርሷቸዋል)`, mainKb());
  }
  return next();
});

// ══ LOCATION ═════════════════════════════════════════════
bot.on('location', async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude: lat, longitude: lng } = ctx.message.location;

  if (step === 'COL_LOC' && isAdmin(ctx)) {
    const ro    = byRoute(ctx.session.colRoute);
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

    await ctx.reply(`🗺️ *${ro?.label}* — ${sorted.length} ሰው`, { parse_mode: 'Markdown' });
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      await ctx.reply(
        `*${i+1}.* ${r.fullName} | 📞 ${r.phone} | ${r.weightKg}ኪሎ\n` +
        (r.dist < 9999 ? `📏 ${r.dist.toFixed(1)}ኪሜ` : '📍 አድራሻ አልተላከም'),
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
      '✅ *ምዝገባ ተጠናቋል!*\n\n🏠 ጭነቱ ሲሞላ ቤትዎ ድረስ እንሰበስባለን\n\n' +
      `${ro2?.emoji} ${ro2?.label}\n${capBox(total, ro2?.targetKg || TARGET_KG_DEFAULT)}`,
      { parse_mode: 'Markdown', ...mainKb() }
    );
    for (const aid of ADMIN_IDS) {
      tell(aid, `📍 አድራሻ ደርሷል — ${r.fullName} (${r.phone}) → ${ro2?.label}`);
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }
  return next();
});

bot.hears('⏭️ አድራሻ ሳላጋራ ቀጥል', async ctx => {
  if (ctx.session?.step !== 'LOC') return ctx.reply('👇 መስመር ይምረጡ።', mainKb());
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply(
    '✅ *ምዝገባ ተጠናቋል!*\n\nአድራሻ ኋላ ለመጨምር:\n📋 "የምዝገባ ሁኔታ" → 📍 አድራሻ ላክ',
    { parse_mode: 'Markdown', ...mainKb() }
  );
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r) for (const aid of ADMIN_IDS) tell(aid, `⚠️ አድራሻ አልተላከም — ${r.fullName} (${r.phone})`);
  }
});

// ══ PHOTO ════════════════════════════════════════════════
bot.on('photo', async ctx => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: 'pending' }).sort({ createdAt: -1 });
  if (!r) return ctx.reply('⚠️ ምዝገባ አልተገኘም። 👇 መስመር ይምረጡ።', mainKb());

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = 'reviewing';
  await r.save();
  await ctx.reply('📸 ደርሷል! ⏳ እያረጋገጥን ነው…');

  const verdict = await checkPayment(fileId, r);
  r.aiVerdict   = verdict;
  const autoOk  = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) { r.status = 'approved'; r.aiAutoApproved = true; }
  await r.save();

  await tell(ctx.from.id,
    autoOk
      ? `✅ *ክፍያዎ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል ❓ ${SUPPORT_PHONE}`
      : `✅ *ምዝገባ ደርሷል!*\n\n${card(r.toObject())}\n\nክፍያዎ እየተፈተሸ ነው — ትንሽ ይጠብቁ ❓ ${SUPPORT_PHONE}`
  );

  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('📍 *ጭነቱ የሚሰበሰብበት አድራሻ ያጋሩ*\n\n👇 ቁልፍ ይጫኑ', { parse_mode: 'Markdown', ...locKb() });

  const adminCaption = aiSummary(verdict) + '\n\n' + (autoOk ? '✅ AI ያረጋገጠ\n\n' : '') + card(r.toObject(), true);
  const adminKb = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk ? '↩️ ሰርዝ' : '✅ ፈቀድ', autoOk ? `no_${r._id}` : `ok_${r._id}`),
    Markup.button.callback('❌ ከልክል', `no_${r._id}`),
  ]]);
  for (const aid of ADMIN_IDS) {
    bot.telegram.sendPhoto(aid, fileId, { caption: adminCaption, parse_mode: 'Markdown', ...adminKb }).catch(() => {});
  }
});

// ══ Admin Panel ══════════════════════════════════════════
bot.hears('🔧 Admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  ctx.session = {};
  await ctx.reply('🔧 *Admin Panel*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    ...ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)]),
    [Markup.button.callback('🔍 ያልተፈቀዱ ክፍያዎች', 'lst_pay')],
    [Markup.button.callback('🗺️ ሰብሳቢ ዝርዝር',    'col_pick')],
    [Markup.button.callback('🚚 ጭነት ላክ',         'snd_pick')],
    [Markup.button.callback('📊 ሪፖርት',           'report')],
    [Markup.button.callback('📢 ቻናል',             'channel_panel')],
    [Markup.button.callback('🖨️ ፕሪንት ዝርዝር',      'print_pick')],
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
    const kb  = approveKb(r._id);
    if (r.paymentFileId) {
      await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: 'Markdown', ...kb });
    } else {
      await ctx.reply(txt, { parse_mode: 'Markdown', ...kb });
    }
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status: newStatus }, { new: true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx[fn](card(r.toObject(), true), { parse_mode: 'Markdown' }).catch(() => {});
  if (notifyFn) await tell(r.userId, notifyFn(r));
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
    `❌ ክፍያዎ አልተቀበለም። ለእርዳታ: ❓ ${SUPPORT_PHONE}`
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async ctx => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from.id && !isAdmin(ctx)) return;
  if (r.status === 'sent') return ctx.reply('⚠️ ጭነቱ ቀድሞ ተልኳል — መሰረዝ አይቻልም።');
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply('🗑️ ምዝገባ ተሰርዟል።\n\n👇 ለመመዝገብ መስመር ይምረጡ።', mainKb());
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
    `🚚 *${ro?.label}*\n👥 ${ready.length} ሰው | ⚖️ ${total} ኪሎ\n\n📝 ማስታወሻ ያስገቡ:\n_ለምሳሌ: ሲኖትራክ — ሰኞ ጠዋት 6:00_`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('report', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = '📊 *ሪፖርት*\n━━━━━━━━━━━━━━━━━━\n';
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const m = {}; counts.forEach(c => { m[c._id] = c.n; });
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
  await ctx.reply('📍 *የእርስዎን ቦታ ያጋሩ:*\n\n👇 ቁልፍ ይጫኑ', { parse_mode: 'Markdown', ...locKb() });
});

bot.action('print_pick', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🖨️ *የትኛው መስመር?*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])) });
});

bot.action(/^prnt_([a-z_]+)$/, async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) { await ctx.reply('❗ መስመር አልተገኘም'); return; }
  try {
    const list = await Reg.find({ routeId: ro.id, status: { $ne: 'rejected' } })
      .sort({ createdAt: 1 }).lean();
    if (!list.length) return ctx.reply(`${ro.emoji} *${ro.label}*\n\n📭 ምዝገባ የለም።`, { parse_mode: 'Markdown' });
    const total = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    await ctx.reply(
      `🖨️ *${ro.label}*\n👥 ${list.length} ሰው | ⚖️ ${total} ኪሎ\n━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
    for (let i = 0; i < list.length; i += 20) {
      let rows = '';
      for (const [j, r] of list.slice(i, i + 20).entries()) {
        const loc = r.locationLat ? `[📍](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : '—';
        rows += `*${i+j+1}.* ${r.fullName||'—'} | 📞 ${r.phone||'—'} | ${r.weightKg}ኪሎ | ${STATUS_LABEL[r.status]} | ${loc}\n`;
      }
      await ctx.reply(rows.trim(), { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    await ctx.reply(`━━━━━━━━━━━━━━━━━━\n✅ ጠቅላላ: *${list.length} ሰው* | *${total} ኪሎ*`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('prnt err:', e);
    await ctx.reply(`❌ ስህተት: ${e.message || 'unknown'}`);
  }
});

bot.action('channel_panel', async ctx => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery('⛔').catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const connected = CHANNEL_ID ? `✅ \`${CHANNEL_ID}\`` : '❌ CHANNEL_ID አልተቀመጠም';
  await ctx.reply(`📢 *ቻናል*\n\n${connected}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
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
  } catch (e) {
    await ctx.reply(`❌ አልተሳካም: ${e.message}\n\nቦቱ የቻናሉ admin መሆኑን ያረጋግጡ።`);
  }
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
      `📢 *${ro.label}*\n\n${capBox(total, ro.targetKg)}\n\n📦 የጋራ ጭነት — ርካሽ እና ፈጣን!\n❓ ${SUPPORT_PHONE}`,
      { parse_mode: 'Markdown' }
    );
    await ctx.reply(`✅ ማስታወቂያ ተልኳል — ${ro.label}`);
  } catch (e) {
    await ctx.reply(`❌ አልተሳካም: ${e.message}`);
  }
});

bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery('⚠️ ጊዜው አልፏል — /start ይሞክሩ').catch(() => {});
});

// ══ LAUNCH ════════════════════════════════════════════════
const http  = require('http');
const https = require('https');
const PORT  = Number(process.env.PORT) || 3000;

mongoose.connect(MONGO_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 })
  .then(() => {
    console.log('✅ MongoDB');
    http.createServer((_, res) => { res.writeHead(200); res.end('OK'); })
      .listen(PORT, () => console.log('✅ Port', PORT));
    const RURL = process.env.RENDER_EXTERNAL_URL || '';
    if (RURL) {
      setInterval(() => {
        try {
          const u = new URL(RURL);
          https.request({ hostname: u.hostname, path: '/', method: 'GET' }, () => {})
            .on('error', () => {}).end();
        } catch {}
      }, 10 * 60 * 1000);
    }
    return bot.launch({ dropPendingUpdates: true });
  })
  .then(() => console.log('✅ Bot ሰርቷል'))
  .catch(err => { console.error('❌', err.message); process.exit(1); });

process.once('SIGINT',  () => { bot.stop(); process.exit(0); });
process.once('SIGTERM', () => { bot.stop(); process.exit(0); });
