const { google } = require('googleapis');
const { Events } = require('discord.js');
const fs = require('fs');
const keys = require('./credentials.json');

const LOG_FILE = './messageLog.json';

function loadLog() {
    if (!fs.existsSync(LOG_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(LOG_FILE)); } catch (e) { return {}; }
}

function saveLog(data) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

let queue = Promise.resolve();
function addQueue(task) {
    queue = queue.then(task).catch(console.error);
    return queue;
}

async function initBot(client, config) {
    client.once(Events.ClientReady, async () => {
        console.log('✅ Police Bot Online!');
        for (const guild of client.guilds.cache.values()) {
            await guild.members.fetch().catch(() => {});
        }
    });

    client.on('messageCreate', async (message) => {
        try {
            const ids = config.CHANNELS;
            const allowed = [ids.TECH2, ids.KADEE, ids.CAR, ids.EXAM];
            if (!message.guild || message.author.bot || !allowed.includes(message.channel.id)) return;

            const tagList = getTagsFromContent(message);
            if (tagList.length === 0) return;

            if (!message.content.includes('<@')) {
                const mentionString = tagList.map(p => `<@${p.id}>`).join(' ');
                const botMsg = await message.channel.send(`📝 **บันทึก:** ${mentionString}`);
                const log = loadLog();
                log[botMsg.id] = tagList;
                saveLog(log);
                await addQueue(() => processSheetBatch(tagList, botMsg, config, false, true));
                if (message.deletable) await message.delete().catch(() => {});
            } else {
                await message.react('✅').catch(() => {});
                const log = loadLog();
                if (log[message.id]) return;
                log[message.id] = tagList;
                saveLog(log);
                await addQueue(() => processSheetBatch(tagList, message, config, false, true));
            }
        } catch (e) { console.error('❌ Error'); }
    });

    client.on('messageDelete', async (message) => {
        try {
            if (message.partial) await message.fetch().catch(() => {});
            const log = loadLog();
            const tagList = log[message.id];
            if (!tagList) return;
            delete log[message.id];
            saveLog(log);
            await addQueue(() => processSheetBatch(tagList, message, config, true, true));
        } catch (e) { console.error('❌ Error'); }
    });

    client.on('messageUpdate', async (oldM, newM) => {
        try {
            if (newM.partial) await newM.fetch().catch(() => {});
            if (!newM.guild || newM.author?.bot) return;

            const log = loadLog();
            const oldList = log[newM.id] || [];
            const newList = getTagsFromContent(newM);
            const oldIds = oldList.map(x => x.id);
            const newIds = newList.map(x => x.id);

            const added = newList.filter(x => !oldIds.includes(x.id));
            const removed = oldList.filter(x => !newIds.includes(x.id));
            if (added.length === 0 && removed.length === 0) return;

            const oldFirst = oldList[0] || null;
            const newFirst = newList[0] || null;

            if (oldFirst?.id !== newFirst?.id) {
                if (oldFirst) await addQueue(() => processSheetBatch([oldFirst], newM, config, true, true, true));
                if (newFirst) await addQueue(() => processSheetBatch([newFirst], newM, config, false, true, true));
            }

            if (removed.length > 0) await addQueue(() => processSheetBatch(removed, newM, config, true, false));
            if (added.length > 0) await addQueue(() => processSheetBatch(added, newM, config, false, false));

            log[newM.id] = newList;
            saveLog(log);
        } catch (e) { console.error('❌ Error'); }
    });
}

function getTagsFromContent(message) {
    if (!message || !message.content) return [];
    let tagList = [];
    const content = message.content.trim();
    const mentionRegex = /<@!?(\d+)>/g;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
        const member = message.guild.members.cache.get(match[1]);
        if (member) addPersonToList(tagList, member);
    }
    const words = content.split(/\s+/);
    let afterBy = false;
    for (const w of words) {
        if (w.toLowerCase() === 'by') { afterBy = true; continue; }
        if (afterBy && /^\d{2,4}$/.test(w)) {
            const m = message.guild.members.cache.find(mem => {
                const n = (mem.nickname || mem.user.displayName || mem.user.username || "").trim();
                return n.match(/^(\d{2,4})\b/) && n.startsWith(w);
            });
            if (m) addPersonToList(tagList, m);
        }
    }
    return tagList;
}

function addPersonToList(list, m) {
    if (!list.some(p => p.id === m.id)) {
        list.push({ id: m.id, nickname: (m.nickname || m.user.displayName || m.user.username).trim() });
    }
}

function findUserRow(rows, person) {
    return rows.findIndex((r, idx) => idx >= 3 && r[0] && r[0].toLowerCase() === person.nickname.toLowerCase());
}

async function processSheetBatch(list, msg, config, isDel = false, incBonus = true, onlyBonus = false) {
    try {
        const auth = new google.auth.GoogleAuth({ credentials: { client_email: keys.client_email, private_key: keys.private_key }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.SPREADSHEET_ID, range: `${config.SHEET_NAME}!A:G` });
        let rows = res.data.values || [];
        
        const chMap = { 
            [config.CHANNELS.TECH2]: { idx: 2, name: "TECH2" }, 
            [config.CHANNELS.KADEE]: { idx: 3, name: "คดี" }, 
            [config.CHANNELS.CAR]:   { idx: 5, name: "รถ" }, 
            [config.CHANNELS.EXAM]:  { idx: 6, name: "สอบ" } 
        };
        
        const chInfo = chMap[msg.channel.id];
        if (!chInfo) return;
        const amt = isDel ? -1 : 1;

        console.log(`\n📊 ${isDel ? 'ลดแต้ม' : 'เพิ่มแต้ม'} (${list.length})`);

        for (const p of list) {
            let rIdx = findUserRow(rows, p);
            if (rIdx !== -1) {
                if (!onlyBonus) {
                    let oldVal = parseInt(rows[rIdx][chInfo.idx] || '0');
                    let newVal = oldVal + amt;
                    rows[rIdx][chInfo.idx] = newVal.toString();
                    console.log(`[${isDel ? '-' : '+'}] ${p.nickname} | ${chInfo.name}: ${oldVal} ➡️ ${newVal}`);
                }
                
                if (incBonus && p.id === list[0].id && (msg.channel.id === config.CHANNELS.KADEE || msg.channel.id === config.CHANNELS.CAR)) {
                    let oldBonus = parseInt(rows[rIdx][4] || '0');
                    let newBonus = oldBonus + amt;
                    rows[rIdx][4] = newBonus.toString();
                    console.log(`Bonus ${isDel ? 'ลด' : 'เพิ่ม'}: ${p.nickname} ${oldBonus} ➡️ ${newBonus}`);
                }
            } else if (!isDel) {
                const newR = [p.nickname, '', '0','0','0','0','0'];
                if (!onlyBonus) newR[chInfo.idx] = '1';
                if (incBonus && p.id === list[0].id && (msg.channel.id === config.CHANNELS.KADEE || msg.channel.id === config.CHANNELS.CAR)) newR[4] = '1';
                rows.push(newR);
                console.log(`[+] ${p.nickname} (คนใหม่) | ${chInfo.name}: 0 ➡️ 1`);
                if (newR[4] === '1') console.log(`Bonus เพิ่ม: ${p.nickname} 0 ➡️ 1`);
            }
        }

        await sheets.spreadsheets.values.update({ spreadsheetId: config.SPREADSHEET_ID, range: `${config.SHEET_NAME}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: rows } });
        console.log(`✅ อัปเดตสำเร็จ`);

    } catch (e) { console.error('❌ API Error'); }
}

module.exports = { initBot };
