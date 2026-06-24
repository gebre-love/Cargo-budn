'use strict';

const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

// ══ CONFIG ════════════════════════════════════════════════
const BOT_TOKEN       = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI       = process.env.MONGO_URI  || '';
const SUPPORT_PHONE   = process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS       = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const PRICE_PER_KG    = 10;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || '';
const AI_AUTO_APPROVE = (process.env.AI_AUTO_APPROVE || 'true') === 'true';

if (!BOT_TOKEN || !MONGO_URI) { console.error('BOT_TOKEN እና MONGO_URI ያስፈልጋሉ'); process.exit(1); }

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ══ መስመሮች (Route → Stops) ════════════════════════════════
const ROUTES = [
  {
    id: 'bahirdar',
    label: 'አዲስ አበባ → ባህር ዳር',
    emoji: '🔵',
    stops: [
      { id: 'debre_markos', label: 'ደብረ ማርቆስ' },
      { id: 'finotselam',   label: 'ፍኖተሰላም'   },
      { id: 'mota',         label: 'ሞጣ'        },
      { id: 'bahirdar',     label: 'ባህር ዳር'    },
    ],
  },
  {
    id: 'hawassa',
    label: 'አዲስ አበባ → ሀዋሳ',
    emoji: '🟢',
    stops: [
      { id: 'ziway',      label: 'ዚዋይ'   },
      { id: 'shashemene', label: 'ሻሸመኔ'  },
      { id: 'hawassa',    label: 'ሀዋሳ'   },
    ],
  },
  {
    id: 'dire',
    label: 'አዲስ አበባ → ድሬዳዋ',
    emoji: '🟠',
    stops: [
      { id: 'adama', label: 'አዳማ'  },
      { id: 'chiro', label: 'ጭሮ'   },
      { id: 'dire',  label: 'ድሬዳዋ' },
    ],
  },
  {
    id: 'mekelle',
    label: 'አዲስ አበባ → መቀሌ',
    emoji: '🔴',
    stops: [
      { id: 'dessie',  label: 'ደሴ'   },
      { id: 'woldiya', label: 'ወልዲያ' },
      { id: 'mekelle', label: 'መቀሌ'  },
    ],
  },
];

const METHODS = [
  { id: 'telebirr', label: 'ቴሌብር',   emoji: '📱', info: process.env.TELEBIRR_INFO || 'Telebirr: 0960336138' },
  { id: 'cbe',      label: 'CBE ባንክ', emoji: '🏦', info: process.env.CBE_INFO     || 'CBE: 1000370308447'  },
];

const byRoute  = id => ROUTES.find(r => r.id === id);
const byMethod = id => METHODS.find(m => m.id === id);
const byStop   = (route, stopId) => route?.stops.find(s => s.id === stopId);

// ══ DB ═══════════════════════════════════════════════════
const Reg = mongoose.model('Reg', new mongoose.Schema({
  userId:        { type: Number, required: true },
  username:      { type: String, default: '' },
  fullName:      String,
  phone:         String,
  routeId:       String,
  stopId:        String,
  cargoDesc:     String,
  weightKg:      { type: Number, default: 0 },
  totalPrice:    { type: Number, default: 0 },
  paymentMethod: { type: String, default: null },
  paymentFileId: { type: String, default: null },
  locationLat:   { type: Number, default: null },
  locationLng:   { type: Number, default: null },
  status: {
    type: String, default: 'pending',
    enum: ['pending', 'reviewing', 'approved', 'rejected', 'sent'],
  },
  aiVerdict:      { type: mongoose.Schema.Types.Mixed, default: null },
  aiAutoApproved: { type: Boolean, default: false },
  batchId:        { type: String, default: null },
  createdAt:      { type: Date, default: Date.now },
}));

const Batch = mongoose.model('Batch', new mongoose.Schema({
  batchId:    { type: String, unique: true },
  routeId:    String,
  memberIds:  [Number],
  note:       String,
  sentAt:     { type: Date, default: Date.now },
}));

const Session = mongoose.model('Session', new mongoose.Schema({
  key:       { type: String, unique: true },
  data:      { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 * 3 } },
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

const ST = {
  pending:   '⏳ ክፍያ ይጠብቃል',
  reviewing: '🔍 እየታየ ነው',
  approved:  '✅ ተፈቅዷል',
  rejected:  '❌ ተከልክሏል',
  sent:      '🚚 ተላልፏል',
};

function card(r, admin = false) {
  const ro   = byRoute(r.routeId);
  const stop = byStop(ro, r.stopId);
  const me   = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji || '📦'} *የጋራ ጭነት ምዝገባ*\n` +
    `ስም: ${r.fullName}\n` +
    `ስልክ: ${r.phone}\n` +
    `መስመር: ${ro?.label}\n` +
    `መድረሻ: *${stop?.label || '—'}*\n` +
    `ጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `ዋጋ: ${r.totalPrice} ብር\n` +
    `ክፍያ: ${me?.label || '—'}\n` +
    `ቦታ: ${r.locationLat ? `[Maps](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : 'አልተላከም'}\n` +
    `ሁኔታ: ${ST[r.status] || r.status}`;
  if (r.aiAutoApproved) t += '\n🤖 AI ያረጋገጠ';
  if (admin) t += `\nTelegram: \`${r.userId}\`${r.username ? ' @' + r.username : ''}`;
  return t;
}

// Keyboards
const mainKb = () => Markup.keyboard([
  ['📦 ጭነት መመዝገብ'],
  ['📋 የምዝገባ ሁኔታ'],
  ...(ADMIN_IDS.length ? [['🔧 Admin']] : []),
]).resize();

const locKb = () => Markup.keyboard([
  [Markup.button.locationRequest('📍 ቦታዬን አጋራ')],
  ['⏭️ ቦታ ሳላጋራ ቀጥል'],
]).resize().oneTime();

const okNoKb = id => Markup.inlineKeyboard([[
  Markup.button.callback('✅ ፈቀድ',  `ok_${id}`),
  Markup.button.callback('❌ ከልክል', `no_${id}`),
]]);

async function tell(uid, txt) {
  await bot.telegram.sendMessage(uid, txt, { parse_mode: 'Markdown' }).catch(() => {});
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
          `Reply ONLY JSON: {"amount_match":bool,"account_match":bool,"looks_edited":bool,"confidence":"high|medium|low","reason":"amharic"}` },
      ]}],
    });
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) { console.error('AI:', e.message); return null; }
}

const aiOk  = r => r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === 'high';
const aiTxt = r => !r
  ? '🤖 AI: ማረጋገጫ አልተሳካም — Admin ይፈትሽ'
  : `🤖 ${aiOk(r) ? '✅ ትክክል' : r?.looks_edited ? '⚠️ ሊደናቀፍ ይችላል' : '❌ አልተሳካም'} | መጠን:${r.amount_match ? '✅' : '❌'} አካውንት:${r.account_match ? '✅' : '❌'} (${r.confidence})\n${r.reason || ''}`;

// ══ BOT ══════════════════════════════════════════════════
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);

// /start
bot.start(async ctx => {
  ctx.session = {};
  await ctx.reply(
    '🚚 *የጋራ ጭነት አገልግሎት*\n\nጭነትዎን ከሌሎች ጋር በአንድ መኪና እናጓጉዛለን።\n💰 10 ብር / ኪሎ\n\n👇 ከታች ይምረጡ:',
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ══ ጭነት መመዝገብ — Route → Stop → Form ════════════════════
bot.hears('📦 ጭነት መመዝገብ', async ctx => {
  ctx.session = { step: 'ROUTE' };
  await ctx.reply(
    '1️⃣ *የጉዞ መስመር ይምረጡ:*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(
        ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `rt_${r.id}`)])
      ),
    }
  );
});

// Route selected → show stops
bot.action(/^rt_(.+)$/, async ctx => {
  ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'ROUTE') return;
  const ro = byRoute(ctx.match[1]);
  if (!ro) return ctx.reply('❗ አልተገኘም።');

  // ቀደም ሲል ምዝገባ ካለ
  const ex = await Reg.findOne({ userId: ctx.from.id, routeId: ro.id, status: { $nin: ['rejected'] } }).lean();
  if (ex) {
    const btns = [];
    if (ex.status !== 'sent') btns.push(Markup.button.callback('🗑️ ሰርዝ', `del_${ex._id}`));
    if (!ex.locationLat && ex.status !== 'sent') btns.push(Markup.button.callback('📍 ቦታ ላክ', `addloc_${ex._id}`));
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return ctx.reply(card(ex) + '\n\n_ቀደም ሲል ተመዝግበዋል_', {
      parse_mode: 'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}),
    });
  }

  ctx.session = { step: 'STOP', routeId: ro.id, d: {} };
  await ctx.editMessageText(
    `${ro.emoji} *${ro.label}*\n\n2️⃣ *መድረሻዎ የት ነው?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(
        ro.stops.map(s => [Markup.button.callback(`📍 ${s.label}`, `st_${s.id}`)])
      ),
    }
  );
});

// Stop selected → start form
bot.action(/^st_(.+)$/, async ctx => {
  ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'STOP') return;
  const ro   = byRoute(ctx.session.routeId);
  const stop = byStop(ro, ctx.match[1]);
  if (!stop) return ctx.reply('❗ አልተገኘም።');

  ctx.session.d.stopId = stop.id;
  ctx.session.step     = 'NAME';
  await ctx.editMessageText(
    `${ro?.emoji} *${ro?.label}* → 📍 *${stop.label}*\n\n3️⃣ ሙሉ ስምዎን ያስገቡ:`,
    { parse_mode: 'Markdown' }
  );
});

// ══ Status ═══════════════════════════════════════════════
bot.hears('📋 የምዝገባ ሁኔታ', async ctx => {
  ctx.session = {};
  const list = await Reg.find({ userId: ctx.from.id, status: { $nin: ['rejected'] } }).lean();
  if (!list.length) return ctx.reply('📭 ምዝገባ የለዎትም።\n\n📦 ጭነት መመዝገብ ይጫኑ።', mainKb());
  for (const r of list) {
    const btns = [];
    if (r.status !== 'sent') btns.push(Markup.button.callback('🗑️ ሰርዝ', `del_${r._id}`));
    if (!r.locationLat && r.status !== 'sent') btns.push(Markup.button.callback('📍 ቦታ ላክ', `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode: 'Markdown', ...(btns.length ? Markup.inlineKeyboard([btns]) : {}) });
  }
});

bot.action(/^addloc_([a-f\d]{24})$/i, async ctx => {
  ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from.id) return ctx.reply('❗ አልተገኘም።');
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('📍 ከታች ያለውን ቁልፍ ይጫኑ:', locKb());
});

// ══ Admin ════════════════════════════════════════════════
bot.hears('🔧 Admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
  ctx.session = {};
  await ctx.reply('🔧 *Admin*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    ...ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)]),
    [Markup.button.callback('🔍 ያልተረጋገጡ ክፍያዎች', 'lst_pay')],
    [Markup.button.callback('🗺️ ሰብሳቢ ዝርዝር',     'col_pick')],
    [Markup.button.callback('🚚 ጭነት ላክ',          'snd_pick')],
    [Markup.button.callback('📊 ሪፖርት',            'report')],
  ]) });
});

// Admin: list per route, grouped by stop
bot.action(/^lst_([^_p][^_]*)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  const ro   = byRoute(ctx.match[1]);
  const list = await Reg.find({ routeId: ro?.id }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply(`${ro?.emoji} ${ro?.label} — ምዝገባ የለም።`);
  const c = {};
  list.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
  await ctx.reply(
    `${ro?.emoji} *${ro?.label}*\nጠቅላላ: ${list.length} | ⏳${c.pending||0} 🔍${c.reviewing||0} ✅${c.approved||0} 🚚${c.sent||0}`,
    { parse_mode: 'Markdown' }
  );
  for (const stop of ro.stops) {
    const grp = list.filter(r => r.stopId === stop.id);
    if (!grp.length) continue;
    await ctx.reply(`\n📍 *${stop.label}* — ${grp.length} ሰው`, { parse_mode: 'Markdown' });
    for (const r of grp) {
      const kb = r.status === 'reviewing' ? okNoKb(r._id)
        : r.status === 'approved' ? Markup.inlineKeyboard([[Markup.button.callback('❌ ሰርዝ', `no_${r._id}`)]])
        : {};
      await ctx.reply(card(r, true), { parse_mode: 'Markdown', ...kb });
    }
  }
});

// Admin: pending payments
bot.action('lst_pay', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  const list = await Reg.find({ status: 'reviewing' }).sort({ createdAt: 1 }).lean();
  if (!list.length) return ctx.reply('✅ ያልተረጋገጠ ክፍያ የለም።');
  for (const r of list) {
    const txt = aiTxt(r.aiVerdict) + '\n\n' + card(r, true);
    const kb  = okNoKb(r._id);
    if (r.paymentFileId) await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: 'Markdown', ...kb });
    else await ctx.reply(txt, { parse_mode: 'Markdown', ...kb });
  }
});

// Approve / Reject
async function setStatus(ctx, id, status, msgFn) {
  const r = await Reg.findByIdAndUpdate(id, { status }, { new: true });
  if (!r) return ctx.reply('❗ አልተገኘም።');
  const fn = ctx.editMessageCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx[fn](card(r.toObject(), true), { parse_mode: 'Markdown' }).catch(() => {});
  if (msgFn) await tell(r.userId, msgFn(r));
}

bot.action(/^ok_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery('✅').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'approved', r =>
    `✅ *ክፍያዎ ተረጋግጧል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል። ❓ ${SUPPORT_PHONE}`
  );
});

bot.action(/^no_([a-f\d]{24})$/i, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery('❌').catch(() => {});
  await setStatus(ctx, ctx.match[1], 'rejected', () =>
    `❌ ክፍያዎ አልተቀበለም። ለጥያቄ: ${SUPPORT_PHONE}`
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async ctx => {
  ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return ctx.reply('❗ አልተገኘም።');
  if (r.userId !== ctx.from.id && !isAdmin(ctx)) return ctx.reply('⛔');
  if (r.status === 'sent') return ctx.reply('⚠️ ጭነቱ ቀድሞ ተልኳል።');
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  ctx.reply('🗑️ ምዝገባ ተሰርዟል።', mainKb());
});

// Admin: ጭነት ላክ
bot.action('snd_pick', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🚚 *ምን መስመር ጭነት ይላካል?*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])) });
});

bot.action(/^snd_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  const ro    = byRoute(ctx.match[1]);
  const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
  if (!ready.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ የለም።');

  // Stop by stop summary
  let summary = `🚚 *${ro?.label}*\n\n`;
  for (const stop of ro.stops) {
    const grp = ready.filter(r => r.stopId === stop.id);
    if (!grp.length) continue;
    const kg = grp.reduce((s, r) => s + (r.weightKg || 0), 0);
    summary += `📍 ${stop.label}: ${grp.length} ሰው | ${kg} ኪሎ\n`;
  }
  summary += `\nጠቅላላ: ${ready.length} ሰው\n\n📝 *ለጭነቶቹ ማስታወሻ ያስገቡ:*\n_ለምሳሌ: ሲኖትራክ — ሰኞ ጠዋት 6:00_`;

  ctx.session = { step: 'SEND_NOTE', sendRoute: ro?.id };
  await ctx.reply(summary, { parse_mode: 'Markdown' });
});

// Admin: Report
bot.action('report', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  let txt = '📊 *ሪፖርት*\n';
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const m = {}; counts.forEach(c => { m[c._id] = c.n; });
    txt += `\n${ro.emoji} ${ro.label}\n⏳${m.pending||0} 🔍${m.reviewing||0} ✅${m.approved||0} 🚚${m.sent||0}`;
  }
  await ctx.reply(txt, { parse_mode: 'Markdown' });
});

// Admin: ሰብሳቢ ዝርዝር
bot.action('col_pick', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🗺️ *መስመር ይምረጡ:*', { parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])) });
});

bot.action(/^col_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: 'COL_LOC', colRoute: ctx.match[1] };
  await ctx.reply('📍 የእርስዎን ቦታ ያጋሩ:', locKb());
});

function km(a1, o1, a2, o2) {
  const R = 6371, da = (a2-a1)*Math.PI/180, doo = (o2-o1)*Math.PI/180;
  const x = Math.sin(da/2)**2 + Math.cos(a1*Math.PI/180)*Math.cos(a2*Math.PI/180)*Math.sin(doo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

// ══ LOCATION ══════════════════════════════════════════════
bot.on('location', async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude: lat, longitude: lng } = ctx.message.location;

  // Admin ሰብሳቢ
  if (step === 'COL_LOC' && isAdmin(ctx)) {
    const ro   = byRoute(ctx.session.colRoute);
    ctx.session = {};
    const list = await Reg.find({ routeId: ro?.id, status: { $in: ['approved','pending','reviewing'] } }).lean();
    if (!list.length) return ctx.reply(`📭 ${ro?.label} — ዝግጁ ምዝገባ የለም።`, mainKb());

    const sorted = list
      .map(r => ({ ...r, d: r.locationLat ? km(lat, lng, r.locationLat, r.locationLng) : 9999 }))
      .sort((a, b) => a.d - b.d);

    for (const stop of ro.stops) {
      const grp = sorted.filter(r => r.stopId === stop.id);
      if (!grp.length) continue;
      const kg = grp.reduce((s, r) => s+(r.weightKg||0), 0);
      await ctx.reply(`📍 *${stop.label}* — ${grp.length} ሰው | ${kg} ኪሎ`, { parse_mode: 'Markdown' });
      for (let i = 0; i < grp.length; i++) {
        const r = grp[i];
        await ctx.reply(
          `${i+1}. *${r.fullName}* | 📞 ${r.phone}\n${r.weightKg}ኪሎ | ${r.totalPrice}ብር | ` +
          (r.d < 9999 ? `📏 ${r.d.toFixed(1)}ኪሜ` : '📍 ቦታ አልተላከም'),
          { parse_mode: 'Markdown' }
        );
        if (r.locationLat) await bot.telegram.sendLocation(ctx.chat.id, r.locationLat, r.locationLng);
      }
    }
    return;
  }

  // ተጠቃሚ ቦታ
  if (step === 'LOC') {
    const regId = ctx.session.locRegId;
    ctx.session = {};
    const r = await Reg.findByIdAndUpdate(regId, { locationLat: lat, locationLng: lng }, { new: true });
    if (!r) return ctx.reply('❗ ምዝገባ አልተገኘም።', mainKb());
    await ctx.reply('✅ ቦታዎ ተመዝግቧል!', mainKb());
    for (const aid of ADMIN_IDS) {
      tell(aid, `📍 ቦታ ደርሷል — ${r.fullName} | ${byStop(byRoute(r.routeId), r.stopId)?.label}`);
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }

  return next();
});

// Skip location
bot.hears('⏭️ ቦታ ሳላጋራ ቀጥል', async ctx => {
  if (ctx.session?.step !== 'LOC') return ctx.reply('ምዝገባ ይጀምሩ።', mainKb());
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply('✅ ምዝገባ ተጠናቋል!\n\nቦታ ኋላ ለማጨምር "📋 የምዝገባ ሁኔታ" → 📍 ቦታ ላክ ይጫኑ።', mainKb());
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r) for (const aid of ADMIN_IDS) tell(aid, `⚠️ ቦታ አልተላከም — ${r.fullName} (${r.phone})`);
  }
});

// Payment method
bot.action(/^pm_(.+)$/, async ctx => {
  ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== 'PAYMETHOD') return;
  const m = byMethod(ctx.match[1]);
  if (!m) return ctx.reply('⚠️ ያልታወቀ ክፍያ መንገድ።');
  const { d, routeId } = ctx.session;
  ctx.session = {};
  const r = await Reg.create({
    userId: ctx.from.id, username: ctx.from.username || '',
    fullName: d.name, phone: d.phone, routeId,
    stopId: d.stopId, cargoDesc: d.cargo,
    weightKg: d.kg, totalPrice: d.price,
    paymentMethod: m.id, status: 'pending',
  });
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const num = m.info.includes(':') ? m.info.split(':').slice(1).join(':').trim() : m.info;
  await ctx.reply(
    `💳 *${r.totalPrice} ብር* ይክፈሉ\n\n${m.emoji} *${m.label}*\nቁጥር: \`${num}\`\n\nከፍለው ከጨረሱ 📸 screenshot ይላኩ።`,
    { parse_mode: 'Markdown', ...mainKb() }
  );
});

// ══ TEXT ══════════════════════════════════════════════════
bot.on('text', async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();

  if (step === 'ROUTE' || step === 'STOP') return ctx.reply('👆 ከላይ ያለውን ቁልፍ ይምረጡ።');

  if (step === 'NAME') {
    if (!txt) return ctx.reply('ስምዎን ያስገቡ:');
    ctx.session.d.name = txt;
    ctx.session.step   = 'PHONE';
    return ctx.reply('4️⃣ ስልክ ቁጥር:');
  }

  if (step === 'PHONE') {
    if (!txt) return ctx.reply('ስልክ ቁጥር ያስገቡ:');
    ctx.session.d.phone = txt;
    ctx.session.step    = 'CARGO';
    return ctx.reply('5️⃣ ጭነት ዓይነት:\n_ለምሳሌ: ሲሚንቶ, ዱቄት, ልብስ_', { parse_mode: 'Markdown' });
  }

  if (step === 'CARGO') {
    if (!txt) return ctx.reply('ጭነት ያስገቡ:');
    ctx.session.d.cargo = txt;
    ctx.session.step    = 'WEIGHT';
    return ctx.reply('6️⃣ ክብደት (ኪሎ):\n_ለምሳሌ: 50_', { parse_mode: 'Markdown' });
  }

  if (step === 'WEIGHT') {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ''));
    if (!kg || kg <= 0) return ctx.reply('⚠️ ቁጥር ያስገቡ — ለምሳሌ: 50');
    ctx.session.d.kg    = kg;
    ctx.session.d.price = kg * PRICE_PER_KG;
    ctx.session.step    = 'PAYMETHOD';
    return ctx.reply(
      `✅ ${kg} ኪሎ = *${kg * PRICE_PER_KG} ብር*\n\n7️⃣ ክፍያ መንገድ ይምረጡ:`,
      { parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(METHODS.map(m => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)]))
      }
    );
  }

  if (step === 'PAYMETHOD') return ctx.reply('👆 ከላይ ያለውን ቁልፍ ይምረጡ።');

  if (step === 'LOC') {
    const tries = (ctx.session.locTries || 0) + 1;
    ctx.session.locTries = tries;
    if (tries >= 3) return ctx.reply(`ለእርዳታ ይደውሉ: ${SUPPORT_PHONE}\nወይም 👇 ⏭️ ቀጥል ይጫኑ።`, locKb());
    return ctx.reply('📍 ጽሁፍ ሳይሆን 👇 "📍 ቦታዬን አጋራ" ቁልፍ ይጫኑ።', locKb());
  }

  if (step === 'SEND_NOTE') {
    if (!isAdmin(ctx)) { ctx.session = {}; return next(); }
    const ro    = byRoute(ctx.session.sendRoute);
    ctx.session = {};
    const ready = await Reg.find({ routeId: ro?.id, status: 'approved' }).lean();
    if (!ready.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ የለም።', mainKb());

    const bid = `${ro?.id.toUpperCase()}-${Date.now()}`;
    await Batch.create({ batchId: bid, routeId: ro?.id, memberIds: ready.map(r => r.userId), note: txt });
    await Reg.updateMany({ _id: { $in: ready.map(r => r._id) } }, { status: 'sent', batchId: bid });

    let sent = 0;
    for (const r of ready) {
      const stop = byStop(ro, r.stopId);
      try {
        await bot.telegram.sendMessage(r.userId,
          `🚚 *ጭነትዎ ተልኳል!*\n\n${ro?.emoji} ${ro?.label}\n📍 መድረሻ: ${stop?.label}\n\n📋 ${txt}\n\n❓ ${SUPPORT_PHONE}`,
          { parse_mode: 'Markdown' }
        );
        sent++;
      } catch {}
    }
    return ctx.reply(`✅ ተልኳል — ${ready.length} ሰው (${sent} ተሳክቷል)`, mainKb());
  }

  return next();
});

// ══ PHOTO ════════════════════════════════════════════════
bot.on('photo', async ctx => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: 'pending' }).sort({ createdAt: -1 });
  if (!r) return ctx.reply('⚠️ ምዝገባ አልተገኘም። 📦 ጭነት መመዝገብ ይጫኑ።', mainKb());

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = 'reviewing';
  await r.save();

  await ctx.reply('📸 ደርሷል! 🤖 AI እያረጋገጠ ነው...');

  const result = await checkPayment(fileId, r);
  r.aiVerdict  = result;
  const autoOk = AI_AUTO_APPROVE && aiOk(result);
  if (autoOk) { r.status = 'approved'; r.aiAutoApproved = true; }
  await r.save();

  await tell(ctx.from.id,
    autoOk
      ? `✅ *ክፍያዎ ተረጋግጧል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል። ❓ ${SUPPORT_PHONE}`
      : `✅ *ምዝገባ ደርሷል!*\n\n${card(r.toObject())}\n\nክፍያዎ እየተፈተሸ ነው። ❓ ${SUPPORT_PHONE}`
  );

  // ቦታ ጥያቄ
  ctx.session = { step: 'LOC', locRegId: String(r._id), locTries: 0 };
  await ctx.reply('📍 ጭነቱ የሚሰበሰብበት ቦታ ያጋሩ:\n\n👇 "📍 ቦታዬን አጋራ" ይጫኑ', locKb());

  // Admin notification
  const caption = aiTxt(result) + '\n\n' + (autoOk ? '✅ AI ያረጋገጠ\n\n' : '') + card(r.toObject(), true);
  const kb = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk ? '↩️ ሰርዝ' : '✅ ፈቀድ', autoOk ? `no_${r._id}` : `ok_${r._id}`),
    Markup.button.callback('❌ ከልክል', `no_${r._id}`),
  ]]);
  for (const aid of ADMIN_IDS) {
    bot.telegram.sendPhoto(aid, fileId, { caption, parse_mode: 'Markdown', ...kb }).catch(() => {});
  }
});

// ══ LAUNCH ════════════════════════════════════════════════
const http = require('http'), https = require('https');
const PORT = Number(process.env.PORT) || 3000;

mongoose.connect(MONGO_URI).then(() => {
  console.log('✅ MongoDB');
  http.createServer((_, res) => { res.writeHead(200); res.end('OK'); }).listen(PORT, () => console.log('✅ Port', PORT));
  const RURL = process.env.RENDER_EXTERNAL_URL || '';
  if (RURL) setInterval(() => {
    try { const u = new URL(RURL); https.request({ hostname: u.hostname, path: '/', method: 'GET' }, r => console.log('🔄', r.statusCode)).on('error', () => {}).end(); } catch {}
  }, 10 * 60 * 1000);
  return bot.launch({ dropPendingUpdates: true });
}).then(() => console.log('✅ Bot ሰርቷል'))
  .catch(err => { console.error('❌', err.message); process.exit(1); });

process.once('SIGINT',  () => { bot.stop(); process.exit(0); });
process.once('SIGTERM', () => { bot.stop(); process.exit(0); });
