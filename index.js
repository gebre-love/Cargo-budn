'use strict';

// ╔══════════════════════════════════════════════════════╗
// ║      ካርጎ ቡድን ሥርዓት  v2.0                          ║
// ║      ካርጎ ቡድን ምዝገባ + ክፍያ Tracking                   ║
// ╚══════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

// ── CONFIG ────────────────────────────────────────────
const BOT_TOKEN     = (process.env.BOT_TOKEN || '').trim();
const MONGO_URI     =  process.env.MONGO_URI || '';
const SUPPORT_PHONE =  process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS     = (process.env.ADMIN_IDS || '')
                        .split(',').map(s => Number(s.trim())).filter(Boolean);
const PAYMENT_INFO  =  process.env.PAYMENT_INFO || 'CBE: 1000XXXXXXX';
const REG_FEE       =  200;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌ BOT_TOKEN እና MONGO_URI አልተገኘም!');
    process.exit(1);
}

// ── ROUTES ────────────────────────────────────────────
const ROUTES = [
    { id: 'hawassa',  label: 'አዲስ አበባ → ሀዋሳ',    emoji: '🟢' },
    { id: 'bahirdar', label: 'አዲስ አበባ → ባህር ዳር',  emoji: '🔵' },
    { id: 'dire',     label: 'አዲስ አበባ → ድሬዳዋ',   emoji: '🟠' },
    { id: 'mekelle',  label: 'አዲስ አበባ → መቀሌ',    emoji: '🔴' },
];

// ── SCHEMAS ───────────────────────────────────────────
const cargoSchema = new mongoose.Schema({
    userId:      { type: Number, required: true },
    username:    { type: String, default: '' },
    fullName:    { type: String, default: '' },
    phone:       { type: String, default: '' },
    routeId:     { type: String, required: true },
    cargoDesc:   { type: String, default: '' },
    weight:      { type: String, default: '' },
    status: {
        type: String,
        default: 'pending_payment',
        enum: ['pending_payment', 'payment_review', 'approved', 'rejected', 'dispatched']
    },
    paymentFileId: { type: String, default: null },
    groupId:       { type: String, default: null },
    createdAt:     { type: Date, default: Date.now }
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

const CargoReg   = mongoose.model('CargoReg',   cargoSchema);
const DispatchGrp= mongoose.model('DispatchGrp',dispatchSchema);
const BotSession = mongoose.model('BotSession', sessionSchema);

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
        `▸ *ክብደት*      ፦ ${esc(r.weight)}\n` +
        `▸ *ሁኔታ*       ፦ ${statusBadge(r.status)}`;
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

// ── BOT ───────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
bot.use(sessionMW);

// /start
bot.start(async ctx => {
    ctx.session = {};
    await ctx.reply(
        `🚚 *እንኳን ደህና መጡ — ካርጎ ቡድን ሥርዓት*\n\n` +
        `ጭነትዎን ከሌሎች ጋር አጣምረን እናጓጉዛለን።\n` +
        `💳 ምዝገባ ክፍያ: *${REG_FEE} ብር*\n\n` +
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
        // Send payment screenshot if exists
        if (r.paymentFileId) {
            await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, {
                caption: regCard(r, true),
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ ፈቀድ',  `pay_ok_${r._id}`),
                        Markup.button.callback('❌ ከልክል', `pay_no_${r._id}`)
                    ]
                ])
            });
        } else {
            await ctx.reply(regCard(r, true), {
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
    ctx.editMessageCaption
        ? ctx.editMessageCaption(regCard(reg.toObject(), true), { parse_mode: 'Markdown' }).catch(()=>{})
        : ctx.editMessageText(regCard(reg.toObject(), true), { parse_mode: 'Markdown' }).catch(()=>{});
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
    ctx.editMessageCaption
        ? ctx.editMessageCaption(regCard(reg.toObject(), true), { parse_mode: 'Markdown' }).catch(()=>{})
        : ctx.editMessageText(regCard(reg.toObject(), true), { parse_mode: 'Markdown' }).catch(()=>{});
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

// ── TEXT STATE MACHINE ────────────────────────────────
bot.on('text', async (ctx, next) => {
    const action = ctx.session?.action;
    if (!action) return next();
    const text = ctx.message.text.trim();
    const uid  = ctx.from.id;

    // Registration steps
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
        return ctx.reply('`[4/4]` ⚖️ *ክብደት ያስገቡ:*\n_ለምሳሌ: 500 ኪ.ግ_', { parse_mode: 'Markdown' });
    }
    if (action === 'REG_4') {
        ctx.session.regData.weight = text;
        const d = ctx.session.regData;
        const routeId = ctx.session.routeId;
        ctx.session.action  = null;
        ctx.session.regData = {};

        const reg = await CargoReg.create({
            userId:    uid,
            username:  ctx.from.username || '',
            fullName:  d.fullName,
            phone:     d.phone,
            routeId,
            cargoDesc: d.cargoDesc,
            weight:    d.weight,
            status:    'pending_payment'
        });

        await ctx.reply(
            `✅ *ምዝገባ ደርሷል!*\n\n` +
            regCard(reg.toObject()) + `\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💳 አሁን *${REG_FEE} ብር* ወደ ታች ወደ ተጻፈው ቁጥር ይላኩ:\n` +
            `\`${PAYMENT_INFO}\`\n\n` +
            `ከፍለው ከጨረሱ 📸 *የክፍያ screenshot* ይላኩ።`,
            { parse_mode: 'Markdown', ...mainKb() }
        );

        // Notify admins
        for (const adminId of ADMIN_IDS) {
            bot.telegram.sendMessage(adminId,
                `🔔 *አዲስ ምዝገባ!*\n\n${regCard(reg.toObject(), true)}`,
                { parse_mode: 'Markdown' }
            ).catch(()=>{});
        }
        return;
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

// ── PHOTO HANDLER (payment screenshot) ───────────────
bot.on('photo', async ctx => {
    const uid = ctx.from.id;
    // Check if user has a pending_payment registration
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
        `Admin እያረጋገጠ ነው — ትንሽ ይጠብቁ።\n` +
        `❓ ለጥያቄ: \`${SUPPORT_PHONE}\``,
        { parse_mode: 'Markdown', ...mainKb() }
    );

    // Forward to admins with action buttons
    for (const adminId of ADMIN_IDS) {
        bot.telegram.sendPhoto(adminId, fileId, {
            caption: `💳 *አዲስ ክፍያ ማረጋገጫ!*\n\n${regCard(reg.toObject(), true)}`,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ ፈቀድ',  `pay_ok_${reg._id}`),
                    Markup.button.callback('❌ ከልክል', `pay_no_${reg._id}`)
                ]
            ])
        }).catch(()=>{});
    }
});

// ── LAUNCH ────────────────────────────────────────────
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB ተገናኘ');
        return bot.launch({ dropPendingUpdates: true });
    })
    .then(() => console.log('✅ Bot ጀምሯል — Background Worker'))
    .catch(err => { console.error('❌', err.message); process.exit(1); });

process.once('SIGINT',  () => { try { bot.stop('SIGINT');  } catch(_){} process.exit(0); });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch(_){} process.exit(0); });
