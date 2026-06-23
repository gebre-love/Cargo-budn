'use strict';

// ╔══════════════════════════════════════════════════════╗
// ║      ካርጎ ቡድን ሥርዓት  v3.0                          ║
// ║      ካርጎ ቡድን ምዝገባ + AI ክፍያ ማረጋገጫ                 ║
// ╚══════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

// ── CONFIG ────────────────────────────────────────────
const BOT_TOKEN       = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI       =  process.env.MONGO_URI || '';
const SUPPORT_PHONE   =  process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS       = (process.env.ADMIN_IDS || '')
                          .split(',').map(s => Number(s.trim())).filter(Boolean);
const PRICE_PER_KG    =  10;  // 10 ብር per ኪሎ
const ANTHROPIC_KEY   =  process.env.ANTHROPIC_API_KEY || '';
// AI ራሱ "ሙሉ በሙሉ ትክክል ነው" ካለ ብቻ auto-approve ያደርጋል። ሌላው ሁሉ ለAdmin ይላካል።
const AI_AUTO_APPROVE = (process.env.AI_AUTO_APPROVE || 'true') === 'true';

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌ BOT_TOKEN እና MONGO_URI አልተገኘም!');
    process.exit(1);
}
if (!ANTHROPIC_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY አልተገኘም — AI ማረጋገጫ ይታለፋል፣ ሁሉም ክፍያ ለAdmin ብቻ ይላካል።');
}

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ── ROUTES ────────────────────────────────────────────
const ROUTES = [
    { id: 'hawassa',  label: 'አዲስ አበባ → ሀዋሳ',    emoji: '🟢' },
    { id: 'bahirdar', label: 'አዲስ አበባ → ባህር ዳር',  emoji: '🔵' },
    { id: 'dire',     label: 'አዲስ አበባ → ድሬዳዋ',   emoji: '🟠' },
    { id: 'mekelle',  label: 'አዲስ አበባ → መቀሌ',    emoji: '🔴' },
];

// ── PAYMENT METHODS ───────────────────────────────────
// እያንዳንዱ የራሱ account/number አለው — ደንበኛ ከታች ካለው ይመርጣል
const PAYMENT_METHODS = [
    { id: 'telebirr', label: 'ቴሌብር (Telebirr)', emoji: '📱',
      info: process.env.TELEBIRR_INFO || 'Telebirr: 0960336138' },
    { id: 'cbe',      label: 'ንግድ ባንክ (CBE)',     emoji: '🏦',
      info: process.env.CBE_INFO      || 'CBE: 1000370308447' },
];
const methodById = id => PAYMENT_METHODS.find(m => m.id === id);

// ── SCHEMAS ───────────────────────────────────────────
const cargoSchema = new mongoose.Schema({
    userId:      { type: Number, required: true },
    username:    { type: String, default: '' },
    fullName:    { type: String, default: '' },
    phone:       { type: String, default: '' },
    routeId:     { type: String, required: true },
    cargoDesc:   { type: String, default: '' },
    weightKg:    { type: Number, default: 0 },
    totalPrice:  { type: Number, default: 0 },
    locationLat: { type: Number, default: null },
    locationLng: { type: Number, default: null },
    paymentMethod: { type: String, default: null }, // telebirr | cbe | boa | dashen
    status: {
        type: String,
        default: 'pending_payment',
        enum: ['pending_payment', 'payment_review', 'approved', 'rejected', 'dispatched']
    },
    paymentFileId:  { type: String, default: null },
    aiVerdict:      { type: mongoose.Schema.Types.Mixed, default: null }, // AI ትንተና ውጤት ይቀመጥበታል
    aiAutoApproved: { type: Boolean, default: false },
    groupId:        { type: String, default: null },
    createdAt:      { type: Date, default: Date.now }
});

const dispatchSchema = new mongoose.Schema({
    groupId:      { type: String, required: true, unique: true },
    routeId:      { type: String, required: true },
    memberIds:    [{ type: Number }],
    note:         { type: String, default: '' },
    dispatchedAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    key:       { type: String, required: true, unique: true },
    data:      { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now,
                 index: { expireAfterSeconds: 86400 * 3 } }
});

const CargoReg    = mongoose.model('CargoReg',    cargoSchema);
const DispatchGrp = mongoose.model('DispatchGrp', dispatchSchema);
const BotSession  = mongoose.model('BotSession',  sessionSchema);

// ── SESSION ───────────────────────────────────────────
async function getSession(key) {
    try {
        const doc = await BotSession.findOne({ key }).lean();
        return doc ? doc.data : {};
    } catch { return {}; }
}
async function saveSession(key, data) {
    try {
        await BotSession.findOneAndUpdate(
            { key }, { data, updatedAt: new Date() },
            { upsert: true, new: true }
        );
    } catch {}
}
function sessionMW(ctx, next) {
    const key = `${ctx.chat?.id}:${ctx.from?.id}`;
    return getSession(key).then(data => {
        ctx.session = data;
        return next().then(() => saveSession(key, ctx.session));
    });
}

// ── HELPERS ───────────────────────────────────────────
const esc       = t => String(t||'').replace(/[_*[\]()~`>#+=|{}.!\\-]/g,'\\$&');
const isAdmin   = ctx => ADMIN_IDS.includes(ctx.from?.id);
const routeById = id  => ROUTES.find(r => r.id === id);

function statusBadge(s) {
    return {
        pending_payment: '⏳ ክፍያ ይጠብቃል',
        payment_review:  '🔍 ክፍያ በማረጋገጥ ላይ',
        approved:        '✅ ተፈቅዷል',
        rejected:        '❌ ተከልክሏል',
        dispatched:      '🚚 ተላልፏል'
    }[s] || s;
}

function regCard(r, forAdmin = false) {
    const route = routeById(r.routeId);
    let txt =
        `${route?.emoji || '📦'} *ካርጎ ምዝገባ*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `▸ *ስም*        ፦ ${esc(r.fullName)}\n` +
        `▸ *ስልክ*       ፦ \`${esc(r.phone)}\`\n` +
        `▸ *መስመር*      ፦ ${esc(route?.label || r.routeId)}\n` +
        `▸ *ጭነት ዓይነት*  ፦ ${esc(r.cargoDesc)}\n` +
        `▸ *ክብደት*      ፦ ${esc(r.weightKg)} ኪሎ\n` +
        `▸ *ዋጋ*         ፦ ${esc(r.totalPrice)} ብር\n` +
        (r.paymentMethod ? `▸ *ክፍያ መንገድ*  ፦ ${esc(methodById(r.paymentMethod)?.label || r.paymentMethod)}\n` : '') +
        (r.locationLat ? `▸ *ቦታ*         ፦ [Google Maps](https://maps.google.com/?q=${r.locationLat},${r.locationLng})\n` : '')  +
        `▸ *ሁኔታ*       ፦ ${statusBadge(r.status)}`;
    if (r.aiAutoApproved) txt += `\n▸ *ማረጋገጫ*    ፦ 🤖 በAI ራስ-ሰር ተፈቅዷል`;
    if (forAdmin) {
        txt += `\n▸ *Telegram* ፦ \`${r.userId}\`` +
               (r.username ? ` @${esc(r.username)}` : '');
    }
    return txt;
}

function mainKb() {
    const rows = ROUTES.map(r => [`${r.emoji} ${r.label}`]);
    rows.push(['📋 የምዝገባ ሁኔታ']);
    if (ADMIN_IDS.length) rows.push(['🔧 Admin Panel']);
    return Markup.keyboard(rows).resize();
}

// ── AI PAYMENT SCREENSHOT VERIFICATION ────────────────
// ማስታወሻ: AI ምስልን ይተነትናል እንጂ 100% ትክክለኛ ፍርድ መስጠት አይችልም።
// ስለዚህ ግልጽ ትክክለኛ ሲሆን ብቻ auto-approve ያደርጋል፤ ጥርጣሬ ካለ ለAdmin ይተወዋል (auto-reject በፍጹም አያደርግም)።
async function verifyPaymentScreenshot(bot, fileId, reg) {
    if (!anthropic) return null;

    try {
        const fileLink = await bot.telegram.getFileLink(fileId);
        const imgRes    = await fetch(fileLink.href || fileLink.toString());
        if (!imgRes.ok) throw new Error('image fetch failed: ' + imgRes.status);

        const arrayBuffer = await imgRes.arrayBuffer();
        const base64       = Buffer.from(arrayBuffer).toString('base64');
        const mediaType     = imgRes.headers.get('content-type') || 'image/jpeg';

        const method        = methodById(reg.paymentMethod);
        const expectedInfo  = method ? method.info  : 'unspecified';
        const expectedLabel = method ? method.label : 'unspecified';

        const prompt =
`You are reviewing a mobile-money or bank-transfer payment screenshot submitted by a customer of an Ethiopian cargo delivery service.

The customer told us they paid via: ${expectedLabel}
Expected payment details:
- Recipient account/info shown on the receipt should match: "${expectedInfo}"
- Expected amount: ${reg.totalPrice} ETB (Ethiopian Birr) — amount shown should be equal to or greater than this
- The screenshot should be from the "${expectedLabel}" app/service specifically, not a different payment provider

Carefully examine the image and assess:
1. amount_match: does the amount shown match or exceed ${reg.totalPrice} ETB? (true/false)
2. account_match: does the recipient account/name reasonably match "${expectedInfo}"? (true/false)
3. method_match: does the screenshot appear to come from the "${expectedLabel}" app/service the customer claimed to use? (true/false)
4. looks_edited: are there visible signs of digital tampering — mismatched fonts, misaligned or blurry text, inconsistent backgrounds, irregular spacing, pasted-looking elements? (true/false)
5. looks_genuine_app: does this look like a real banking/mobile-money app screen rather than a generic edited image? (true/false)
6. confidence: your overall confidence that this is a genuine, matching payment — "high", "medium", or "low"
7. reason: a short explanation, written in Amharic, of your reasoning

Respond with ONLY valid JSON in this exact shape, nothing else, no markdown fences:
{"amount_match": true, "account_match": true, "method_match": true, "looks_edited": false, "looks_genuine_app": true, "confidence": "high", "reason": "..."}`;

        const msg = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 500,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                    { type: 'text', text: prompt }
                ]
            }]
        });

        const raw = (msg.content.find(b => b.type === 'text') || {}).text || '{}';
        const clean = raw.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (err) {
        console.error('⚠️ AI ክፍያ ማረጋገጫ ስህተት:', err.message);
        return null; // null = AI ማረጋገጥ አልተቻለም → ለAdmin ይተወዋል
    }
}

function aiVerdictText(result) {
    if (!result) {
        return '🤖 *AI ምርመራ:* ⚙️ አልተሳካም — Admin ራሱ ያረጋግጥ';
    }
    const { amount_match, account_match, method_match, looks_edited, looks_genuine_app, confidence, reason } = result;
    let icon = '❓';
    if (amount_match && account_match && method_match !== false && !looks_edited && looks_genuine_app && confidence === 'high') {
        icon = '✅';
    } else if (looks_edited) {
        icon = '⚠️ ሊደባለቅ ይችላል';
    } else if (!amount_match || !account_match || method_match === false) {
        icon = '❌ መጠን/አካውንት/መንገድ አይመጣጠንም';
    }
    return `🤖 *AI ምርመራ:* ${icon}\n` +
           `   መጠን:${amount_match ? '✅' : '❌'} አካውንት:${account_match ? '✅' : '❌'} ` +
           `መንገድ:${method_match === false ? '❌' : '✅'} ተደባልቋል?:${looks_edited ? '⚠️አዎ' : '✅አይደለም'} እምነት:${confidence}\n` +
           `   _${esc(reason || '')}_`;
}

function aiShouldAutoApprove(result) {
    if (!AI_AUTO_APPROVE || !result) return false;
    return result.amount_match === true &&
           result.account_match === true &&
           result.method_match !== false &&
           result.looks_edited === false &&
           result.looks_genuine_app === true &&
           result.confidence === 'high';
}

// ── BOT ───────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);

// /start
bot.start(async ctx => {
    ctx.session = {};
    await ctx.reply(
        `🚚 *እንኳን ደህና መጡ — ካርጎ ቡድን ሥርዓት*\n\n` +
        `ጭነትዎን ከሌሎች ጋር አጣምረን እናጓጉዛለን።\n` +
        `💳 ዋጋ: *10 ብር/ኪሎ* (ለምሳሌ 20ኪሎ = 200ብር)\n\n` +
        `👇 መስመር ይምረጡ:`,
        { parse_mode: 'Markdown', ...mainKb() }
    );
});

// ── ROUTE SELECTION ───────────────────────────────────
ROUTES.forEach(route => {
    bot.hears(`${route.emoji} ${route.label}`, async ctx => {
        const uid = ctx.from.id;
        const existing = await CargoReg.findOne({
            userId: uid, routeId: route.id,
            status: { $nin: ['rejected'] }
        }).lean();

        if (existing) {
            const btns = ['dispatched'].includes(existing.status) ? [] :
                [[Markup.button.callback('🗑️ ምዝገባ ሰርዝ', `cancel_${existing._id}`)]];
            return ctx.reply(
                regCard(existing) + `\n\n_ቀደም ሲል ተመዝግበዋል_`,
                { parse_mode: 'Markdown',
                  ...(btns.length ? Markup.inlineKeyboard(btns) : {}) }
            );
        }

        ctx.session.action  = 'REG_1';
        ctx.session.routeId = route.id;
        ctx.session.regData = {};
        return ctx.reply(
            `${route.emoji} *${esc(route.label)}*\n\n` +
            `\`[1/4]\` 👤 *ሙሉ ስምዎን ያስገቡ:*`,
            { parse_mode: 'Markdown' }
        );
    });
});

// ── STATUS CHECK ──────────────────────────────────────
bot.hears('📋 የምዝገባ ሁኔታ', async ctx => {
    ctx.session.action = null;
    const regs = await CargoReg.find({
        userId: ctx.from.id,
        status: { $nin: ['rejected'] }
    }).lean();
    if (!regs.length) {
        return ctx.reply('📭 ምንም ምዝገባ የለዎትም። መስመር ይምረጡ።', mainKb());
    }
    for (const r of regs) {
        const btns = r.status === 'dispatched' ? [] :
            [[Markup.button.callback('🗑️ ምዝገባ ሰርዝ', `cancel_${r._id}`)]];
        await ctx.reply(regCard(r), {
            parse_mode: 'Markdown',
            ...(btns.length ? Markup.inlineKeyboard(btns) : {})
        });
    }
});

// ── ADMIN PANEL ───────────────────────────────────────
bot.hears('🔧 Admin Panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም።');
    ctx.session.action = null;
    await ctx.reply('🔧 *Admin Panel*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            ...ROUTES.map(r => [
                Markup.button.callback(`${r.emoji} ${r.label}`, `list_${r.id}`)
            ]),
            [Markup.button.callback('🔍 ክፍያ ያልተረጋገጡ', 'list_payments')],
            [Markup.button.callback('🗺️ ሰብሳቢ ዝርዝር', 'collect_choose')],
            [Markup.button.callback('🚚 ቡድን ላክ', 'dispatch_choose')],
            [Markup.button.callback('📊 ጠቅላላ ሪፖርት', 'rep_all')]
        ])
    });
});

// ── ADMIN: list by route ──────────────────────────────
bot.action(/^list_(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    const routeId = ctx.match[1];
    const route   = routeById(routeId);
    const regs    = await CargoReg.find({ routeId }).sort({ createdAt: -1 }).lean();
    if (!regs.length) {
        return ctx.reply(`${route?.emoji} *${esc(route?.label)}* — ምንም ምዝገባ የለም።`,
            { parse_mode: 'Markdown' });
    }
    const c = {};
    regs.forEach(r => { c[r.status] = (c[r.status]||0)+1; });
    await ctx.reply(
        `${route?.emoji} *${esc(route?.label)}*\n` +
        `ጠቅላላ: *${regs.length}* | ⏳${c.pending_payment||0} | 🔍${c.payment_review||0} | ✅${c.approved||0} | 🚚${c.dispatched||0}`,
        { parse_mode: 'Markdown' }
    );
    for (const r of regs) {
        const btns = [];
        if (r.status === 'payment_review') {
            btns.push([
                Markup.button.callback('✅ ክፍያ ፈቀድ', `pay_ok_${r._id}`),
                Markup.button.callback('❌ ከልክል',      `pay_no_${r._id}`)
            ]);
        } else if (r.status === 'approved') {
            btns.push([Markup.button.callback('❌ ምዝገባ ሰርዝ', `pay_no_${r._id}`)]);
        }
        await ctx.reply(regCard(r, true), {
            parse_mode: 'Markdown',
            ...(btns.length ? Markup.inlineKeyboard(btns) : {})
        });
    }
});

// ── ADMIN: pending payments ───────────────────────────
bot.action('list_payments', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    const regs = await CargoReg.find({ status: 'payment_review' })
                               .sort({ createdAt: 1 }).lean();
    if (!regs.length) return ctx.reply('✅ ምንም ያልተረጋገጠ ክፍያ የለም።');
    await ctx.reply(`🔍 *${regs.length}* ክፍያ ይጠብቃል:`, { parse_mode: 'Markdown' });
    for (const r of regs) {
        const caption = (r.aiVerdict ? aiVerdictText(r.aiVerdict) + '\n\n' : '') + regCard(r, true);
        if (r.paymentFileId) {
            await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, {
                caption,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ ፈቀድ',  `pay_ok_${r._id}`),
                        Markup.button.callback('❌ ከልክል', `pay_no_${r._id}`)
                    ]
                ])
            });
        } else {
            await ctx.reply(caption, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ ፈቀድ',  `pay_ok_${r._id}`),
                        Markup.button.callback('❌ ከልክል', `pay_no_${r._id}`)
                    ]
                ])
            });
        }
    }
});

// ── ADMIN: approve payment ────────────────────────────
bot.action(/^pay_ok_([a-f\d]{24})$/i, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery('✅ ተፈቅዷል').catch(()=>{});
    const reg = await CargoReg.findByIdAndUpdate(
        ctx.match[1], { status: 'approved' }, { new: true }
    );
    if (!reg) return ctx.reply('❗ አልተገኘም።');
    const newText = regCard(reg.toObject(), true);
    ctx.editMessageCaption
        ? ctx.editMessageCaption(newText, { parse_mode: 'Markdown' }).catch(()=>{})
        : ctx.editMessageText(newText, { parse_mode: 'Markdown' }).catch(()=>{});
    bot.telegram.sendMessage(reg.userId,
        `✅ *ክፍያዎ ተረጋግጧል!*\n\n` +
        `${routeById(reg.routeId)?.emoji} *${esc(routeById(reg.routeId)?.label)}*\n\n` +
        `ቡድኑ ሲዘጋጅ ይነገርዎታል።\n❓ ለጥያቄ: \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown' }
    ).catch(()=>{});
});

// ── ADMIN: reject payment ─────────────────────────────
bot.action(/^pay_no_([a-f\d]{24})$/i, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery('❌ ተከልክሏል').catch(()=>{});
    const reg = await CargoReg.findByIdAndUpdate(
        ctx.match[1], { status: 'rejected' }, { new: true }
    );
    if (!reg) return ctx.reply('❗ አልተገኘም።');
    const newText = regCard(reg.toObject(), true);
    ctx.editMessageCaption
        ? ctx.editMessageCaption(newText, { parse_mode: 'Markdown' }).catch(()=>{})
        : ctx.editMessageText(newText, { parse_mode: 'Markdown' }).catch(()=>{});
    bot.telegram.sendMessage(reg.userId,
        `❌ ክፍያዎ ተቀባይነት አላገኘም። ለበለጠ: \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown' }
    ).catch(()=>{});
});

// ── ADMIN: cancel registration ────────────────────────
bot.action(/^cancel_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    const uid = ctx.from.id;
    const reg = await CargoReg.findById(ctx.match[1]);
    if (!reg) return ctx.reply('❗ አልተገኘም።');
    if (reg.userId !== uid && !isAdmin(ctx)) return ctx.reply('⛔');
    if (reg.status === 'dispatched') return ctx.reply('⚠️ ቀድሞ ተላልፏል።');
    await reg.deleteOne();
    ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
    ctx.reply('🗑️ ምዝገባ ተሰርዟል።', mainKb());
});

// ── ADMIN: dispatch choose route ──────────────────────
bot.action('dispatch_choose', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    await ctx.reply('🚚 *ምን መስመር ቡድን ይላካል?*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(
            ROUTES.map(r => [Markup.button.callback(`${r.emoji} ${r.label}`, `do_dispatch_${r.id}`)])
        )
    });
});

bot.action(/^do_dispatch_(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    const routeId = ctx.match[1];
    const route   = routeById(routeId);
    const approved = await CargoReg.find({ routeId, status: 'approved' }).lean();
    if (!approved.length) {
        return ctx.reply(`⚠️ ${route?.emoji} ${route?.label} — ✅ ፈቃድ ያለው ምዝገባ የለም።`);
    }
    ctx.session.action          = 'DISPATCH_NOTE';
    ctx.session.dispatchRouteId = routeId;
    return ctx.reply(
        `🚚 *${esc(route?.label)}*\n\n` +
        `👥 *${approved.length}* ሰዎች ዝግጁ ናቸው።\n\n` +
        `📝 *ለቡድኑ ማስታወሻ ያስገቡ:*\n` +
        `_ለምሳሌ: ሲኖትራክ — ሰኞ ሐምሌ 3 ጠ/ቀ 6:00_`,
        { parse_mode: 'Markdown' }
    );
});

// ── ADMIN: global report ──────────────────────────────
bot.action('rep_all', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    let txt = `📊 *ጠቅላላ ሪፖርት*\n━━━━━━━━━━━━━━━\n`;
    for (const route of ROUTES) {
        const counts = await CargoReg.aggregate([
            { $match: { routeId: route.id } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]);
        const m = {};
        counts.forEach(c => { m[c._id] = c.n; });
        const total = Object.values(m).reduce((a,b)=>a+b,0);
        txt += `\n${route.emoji} *${esc(route.label)}*\n`;
        txt += `   ጠቅላላ:${total} | ⏳${m.pending_payment||0} | 🔍${m.payment_review||0} | ✅${m.approved||0} | 🚚${m.dispatched||0}\n`;
    }
    ctx.reply(txt, { parse_mode: 'Markdown' });
});

// ── ADMIN: collection list — choose route ─────────────
bot.action('collect_choose', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    await ctx.reply('🗺️ *ሰብሳቢ ዝርዝር — መስመር ይምረጡ:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(
            ROUTES.map(r => [
                Markup.button.callback(`${r.emoji} ${r.label}`, `collect_${r.id}`)
            ])
        )
    });
});

// ── ADMIN: collection list — ask admin location first ─
bot.action(/^collect_(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    const routeId = ctx.match[1];
    ctx.session.action          = 'COLLECT_LOCATION';
    ctx.session.collectRouteId  = routeId;
    await ctx.reply(
        `🗺️ *${esc(routeById(routeId)?.label)}*\n\n` +
        `📍 *የእርስዎን አሁናዊ ቦታ ያጋሩ*\n` +
        `ቅርብ ቦታ ቀደም ብሎ እንዲታይ:`,
        {
            parse_mode: 'Markdown',
            ...Markup.keyboard([
                [Markup.button.locationRequest('📍 ቦታዬን አጋራ')]
            ]).resize().oneTime()
        }
    );
});

// ── ADMIN: receive location → sort by distance ────────
bot.on('location', async (ctx, next) => {
    if (ctx.session?.action === 'COLLECT_LOCATION' && isAdmin(ctx)) {
        const { latitude: aLat, longitude: aLng } = ctx.message.location;
        const routeId = ctx.session.collectRouteId;
        const route   = routeById(routeId);
        ctx.session.action         = null;
        ctx.session.collectRouteId = null;

        const members = await CargoReg.find({
            routeId,
            status: { $in: ['approved', 'pending_payment', 'payment_review'] }
        }).lean();

        if (!members.length) {
            return ctx.reply(
                `📭 ${route?.emoji} *${esc(route?.label)}* — ምንም ዝግጁ ተጠቃሚ የለም።`,
                { parse_mode: 'Markdown', ...mainKb() }
            );
        }

        function distKm(lat1, lng1, lat2, lng2) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 +
                      Math.cos(lat1 * Math.PI/180) *
                      Math.cos(lat2 * Math.PI/180) *
                      Math.sin(dLng/2)**2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        const sorted = members
            .map(r => ({
                ...r,
                distKm: r.locationLat
                    ? distKm(aLat, aLng, r.locationLat, r.locationLng)
                    : 9999
            }))
            .sort((a, b) => a.distKm - b.distKm);

        const totalKg   = sorted.reduce((s, r) => s + (r.weightKg   || 0), 0);
        const totalBirr = sorted.reduce((s, r) => s + (r.totalPrice || 0), 0);

        await ctx.reply(
            `🗺️ *${esc(route?.label)} — ሰብሳቢ ዝርዝር*\n` +
            `━━━━━━━━━━━━━━━\n` +
            `👥 ሰዎች: *${sorted.length}*\n` +
            `⚖️ ጠቅላላ ክብደት: *${totalKg} ኪሎ*\n` +
            `💰 ጠቅላላ ዋጋ: *${totalBirr} ብር*\n` +
            `📌 ቅርብ ቦታ ቀደም ብሎ ታይቷል`,
            { parse_mode: 'Markdown', ...mainKb() }
        );

        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const statusIcon = {
                pending_payment: '⏳',
                payment_review:  '🔍',
                approved:        '✅'
            }[r.status] || '❓';

            const dist = r.distKm < 9999
                ? `📏 *${r.distKm.toFixed(1)} ኪሜ ርቀት*`
                : `📍 _ቦታ አልተላከም_`;

            const card =
                `*${i + 1}. ${esc(r.fullName)}* ${statusIcon}\n` +
                `📞 \`${esc(r.phone)}\`\n` +
                `📦 ${esc(r.cargoDesc)} — *${r.weightKg} ኪሎ*\n` +
                `💳 *${r.totalPrice} ብር*\n` +
                dist;

            await ctx.reply(card, { parse_mode: 'Markdown' });
            if (r.locationLat && r.locationLng) {
                await bot.telegram.sendLocation(ctx.chat.id, r.locationLat, r.locationLng);
            }
        }
        return;
    }

    return next();
});

// ── PAYMENT METHOD SELECTED → create registration ─────
bot.action(/^paymethod_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    if (ctx.session?.action !== 'REG_PAYMETHOD') return;
    const method = methodById(ctx.match[1]);
    if (!method) return ctx.reply('⚠️ ያልታወቀ ክፍያ መንገድ።');

    const uid     = ctx.from.id;
    const d       = ctx.session.regData;
    const routeId = ctx.session.routeId;
    ctx.session.action  = null;
    ctx.session.regData = {};
    ctx.session.routeId = null;

    const reg = await CargoReg.create({
        userId:        uid,
        username:      ctx.from.username || '',
        fullName:      d.fullName,
        phone:         d.phone,
        routeId,
        cargoDesc:     d.cargoDesc,
        weightKg:      d.weightKg,
        totalPrice:    d.totalPrice,
        locationLat:   null,
        locationLng:   null,
        paymentMethod: method.id,
        status:        'pending_payment'
    });

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});

    await ctx.reply(
        `✅ *ምዝገባ ደርሷል!*\n\n` +
        regCard(reg.toObject()) + `\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `💳 አሁን *${reg.totalPrice} ብር* ${method.emoji} *${esc(method.label)}* ወደ ታች ወደ ተጻፈው ይላኩ:\n` +
        `\`${method.info}\`\n\n` +
        `ከፍለው ከጨረሱ 📸 *የክፍያ screenshot* ይላኩ።`,
        { parse_mode: 'Markdown', ...mainKb() }
    );

    for (const adminId of ADMIN_IDS) {
        bot.telegram.sendMessage(adminId,
            `🔔 *አዲስ ምዝገባ!*\n\n${regCard(reg.toObject(), true)}`,
            { parse_mode: 'Markdown' }
        ).catch(()=>{});
    }
});

// ── USER LOCATION — final step, AFTER payment is sent ─
bot.on('location', async ctx => {
    if (ctx.session?.action !== 'REG_LOCATION_FINAL') return;
    const { latitude, longitude } = ctx.message.location;
    const regId = ctx.session.locationRegId;
    ctx.session.action        = null;
    ctx.session.locationRegId = null;

    const reg = await CargoReg.findByIdAndUpdate(
        regId, { locationLat: latitude, locationLng: longitude }, { new: true }
    );
    if (!reg) return ctx.reply('❗ ምዝገባ አልተገኘም።', mainKb());

    await ctx.reply('📍 *ቦታዎ ተመዝግቧል — እናመስግናለን!*', { parse_mode: 'Markdown', ...mainKb() });

    for (const adminId of ADMIN_IDS) {
        bot.telegram.sendMessage(adminId,
            `📍 *ቦታ ደርሷል* — ${esc(reg.fullName)}`,
            { parse_mode: 'Markdown' }
        ).catch(()=>{});
        bot.telegram.sendLocation(adminId, latitude, longitude).catch(()=>{});
    }
});

bot.on('text', async (ctx, next) => {
    const action = ctx.session?.action;
    if (!action) return next();
    const text = ctx.message.text.trim();
    const uid  = ctx.from.id;

    if (action === 'REG_1') {
        ctx.session.regData = { fullName: text };
        ctx.session.action  = 'REG_2';
        return ctx.reply('`[2/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*', { parse_mode: 'Markdown' });
    }
    if (action === 'REG_2') {
        ctx.session.regData.phone = text;
        ctx.session.action = 'REG_3';
        return ctx.reply('`[3/4]` 📦 *ጭነት ዓይነት ያስገቡ:*\n_ለምሳሌ: ሲሚንቶ, ምግብ ዕቃ_', { parse_mode: 'Markdown' });
    }
    if (action === 'REG_3') {
        ctx.session.regData.cargoDesc = text;
        ctx.session.action = 'REG_4';
        return ctx.reply('`[4/5]` ⚖️ *ክብደት በኪሎ ያስገቡ:*\n_ለምሳሌ: 20_\n\n💡 ዋጋ = ኪሎ × 10 ብር', { parse_mode: 'Markdown' });
    }
    if (action === 'REG_4') {
        const kg = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!kg || kg <= 0) {
            return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ — ለምሳሌ: *20*', { parse_mode: 'Markdown' });
        }
        const totalPrice = kg * PRICE_PER_KG;
        ctx.session.regData.weightKg   = kg;
        ctx.session.regData.totalPrice = totalPrice;
        ctx.session.action = 'REG_PAYMETHOD';
        return ctx.reply(
            `✅ ክብደት: *${kg} ኪሎ* — ዋጋ: *${totalPrice} ብር*\n\n` +
            `\`[ክፍያ]\` 💳 *በምን ይከፍላሉ?*`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(
                    PAYMENT_METHODS.map(m => [
                        Markup.button.callback(`${m.emoji} ${m.label}`, `paymethod_${m.id}`)
                    ])
                )
            }
        );
    }
    if (action === 'REG_PAYMETHOD') {
        return ctx.reply('💳 *ከላይ ካለው ዝርዝር ክፍያ መንገድ ይምረጡ* (ቁልፍ ይጫኑ)።', { parse_mode: 'Markdown' });
    }
    if (action === 'REG_LOCATION_FINAL') {
        return ctx.reply('📍 *ቦታዎን ያጋሩ* — ከታች ያለውን ቁልፍ ይጫኑ።', { parse_mode: 'Markdown' });
    }

    // Dispatch note
    if (action === 'DISPATCH_NOTE') {
        if (!isAdmin(ctx)) { ctx.session.action = null; return next(); }
        const note    = text;
        const routeId = ctx.session.dispatchRouteId;
        const route   = routeById(routeId);
        ctx.session.action          = null;
        ctx.session.dispatchRouteId = null;

        const approved = await CargoReg.find({ routeId, status: 'approved' }).lean();
        if (!approved.length) return ctx.reply('⚠️ ፈቃድ ያለው ምዝገባ አልተገኘም።', mainKb());

        const groupId   = `${routeId.toUpperCase()}-${Date.now()}`;
        const memberIds = approved.map(r => r.userId);

        await DispatchGrp.create({ groupId, routeId, memberIds, note });
        await CargoReg.updateMany(
            { _id: { $in: approved.map(r => r._id) } },
            { status: 'dispatched', groupId }
        );

        let sent = 0;
        for (const r of approved) {
            try {
                await bot.telegram.sendMessage(r.userId,
                    `🚚 *ቡድንዎ ተዘጋጅቷል!*\n\n` +
                    `${route?.emoji} *${esc(route?.label)}*\n\n` +
                    `📋 *ዝርዝር:* ${esc(note)}\n` +
                    `👥 ${approved.length} ጭነቶች ተጣምረዋል\n\n` +
                    `❓ ለጥያቄ: \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
                sent++;
            } catch (_) {}
        }

        return ctx.reply(
            `✅ *ቡድን ተላልፏል!*\n${route?.emoji} ${esc(route?.label)}\n` +
            `👥 አባላት: *${approved.length}* | 📨 ተላከ: *${sent}/${approved.length}*`,
            { parse_mode: 'Markdown', ...mainKb() }
        );
    }

    return next();
});

// ── PHOTO HANDLER (payment screenshot + AI verification) ─
bot.on('photo', async ctx => {
    const uid = ctx.from.id;
    const reg = await CargoReg.findOne({
        userId: uid, status: 'pending_payment'
    }).sort({ createdAt: -1 });

    if (!reg) {
        return ctx.reply(
            '⚠️ ክፍያ screenshot ለሚቀበለው ምዝገባ አልተገኘም።\n' +
            'አስቀድመው ምዝገባ ያድርጉ።',
            mainKb()
        );
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    reg.paymentFileId = fileId;
    reg.status        = 'payment_review';
    await reg.save();

    await ctx.reply(
        `📸 *ክፍያ ምስል ደርሷል!*\n\n` +
        `🤖 በራስ-ሰር በማረጋገጥ ላይ... ትንሽ ይጠብቁ።`,
        { parse_mode: 'Markdown' }
    );

    // 🤖 AI ምስሉን ይተንታል
    const result = await verifyPaymentScreenshot(bot, fileId, reg);
    reg.aiVerdict = result;

    let autoApproved = false;
    if (aiShouldAutoApprove(result)) {
        reg.status         = 'approved';
        reg.aiAutoApproved  = true;
        autoApproved        = true;
    }
    await reg.save();

    if (autoApproved) {
        await bot.telegram.sendMessage(uid,
            `✅ *ክፍያዎ በራስ-ሰር ተረጋግጧል!*\n\n` +
            `${routeById(reg.routeId)?.emoji} *${esc(routeById(reg.routeId)?.label)}*\n\n` +
            `ቡድኑ ሲዘጋጅ ይነገርዎታል።\n❓ ለጥያቄ: \`${SUPPORT_PHONE}\``,
            { parse_mode: 'Markdown' }
        ).catch(()=>{});
    } else {
        await bot.telegram.sendMessage(uid,
            `🔍 Admin እያረጋገጠ ነው — ትንሽ ይጠብቁ።\n` +
            `❓ ለጥያቄ: \`${SUPPORT_PHONE}\``,
            { parse_mode: 'Markdown' }
        ).catch(()=>{});
    }

    // ክፍያው ስለተላከ አሁን ቦታ ይጠይቁ (ለሰብሳቢ/ለመኪና ቅርብነት)
    ctx.session.action        = 'REG_LOCATION_FINAL';
    ctx.session.locationRegId = reg._id.toString();
    await ctx.reply(
        `📍 *መጨረሻ ደረጃ — ቦታዎን ያጋሩ:*\n` +
        `👇 ከታች ያለውን 📎 ቁልፍ ጫኑ → _Location_ ይምረጡ`,
        {
            parse_mode: 'Markdown',
            ...Markup.keyboard([
                [Markup.button.locationRequest('📍 ቦታዬን አጋራ')]
            ]).resize().oneTime()
        }
    );

    // Admin ሁልጊዜ AI ትንታኔ + buttons ይደርሰዋል (auto-approved ቢሆንም ለ oversight)
    const caption = aiVerdictText(result) + '\n\n' +
        (autoApproved ? '✅ *AI በራስ-ሰር ፈቅዷል*\n\n' : '') +
        regCard(reg.toObject(), true);

    for (const adminId of ADMIN_IDS) {
        bot.telegram.sendPhoto(adminId, fileId, {
            caption,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback(autoApproved ? '↩️ ይቅር (Reject)' : '✅ ፈቀድ', autoApproved ? `pay_no_${reg._id}` : `pay_ok_${reg._id}`),
                    Markup.button.callback('❌ ከልክል', `pay_no_${reg._id}`)
                ]
            ])
        }).catch(()=>{});
    }
});

// ── LAUNCH ────────────────────────────────────────────
const http  = require('http');
const https = require('https');
const PORT  = Number(process.env.PORT) || 3000;

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB ተገናኘ');

        http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        }).listen(PORT, () => {
            console.log('✅ HTTP server port ' + PORT);
        });

        const RENDER_URL = process.env.RENDER_EXTERNAL_URL || '';
        if (RENDER_URL) {
            setInterval(() => {
                try {
                    const url = new URL(RENDER_URL);
                    const req2 = https.request(
                        { hostname: url.hostname, path: '/', method: 'GET' },
                        r => { console.log('🔄 Keep-alive ' + r.statusCode); }
                    );
                    req2.on('error', () => {});
                    req2.end();
                } catch (_) {}
            }, 10 * 60 * 1000);
            console.log('✅ Keep-alive ተቀናብሯል → ' + RENDER_URL);
        }

        return bot.launch({ dropPendingUpdates: true });
    })
    .then(() => console.log('✅ Bot ጀምሯል 24/7'))
    .catch(err => { console.error('❌', err.message); process.exit(1); });

process.once('SIGINT',  () => { try { bot.stop('SIGINT');  } catch(_){} process.exit(0); });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch(_){} process.exit(0); });
