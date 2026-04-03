const { google } = require('googleapis');
const { Events } = require('discord.js');
const fs = require('fs');
const keys = require('./credentials.json');

const LOG_FILE = './messageLog.json';

// --- Helper Functions ---
function loadLog() {
    if (!fs.existsSync(LOG_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(LOG_FILE));
    } catch (e) { return {}; }
}

function saveLog(data) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

let queue = Promise.resolve();
function addQueue(task) {
    queue = queue.then(task).catch(console.error);
    return queue;
}

// --- Main Init Function ---
async function initBot(client, config) {

    client.once(Events.ClientReady, async () => {
        console.log('✅ Police Bot Online & PRO Mode!');
        for (const guild of client.guilds.cache.values()) {
            await guild.members.fetch().catch(() => {});
        }
    });

    // 📩 ตรวจจับข้อความใหม่
    client.on('messageCreate', async (message) => {
        try {
            const ids = config.CHANNELS;
            const allowedChannels = [ids.TECH2, ids.KADEE, ids.CAR, ids.EXAM];
            if (!message.guild || message.author.bot) return;
            if (!allowedChannels.includes(message.channel.id)) return;

            const tagList = getTagsFromContent(message);
            if (tagList.length === 0) return;

            const isManualMention = message.content.includes('<@');

            if (!isManualMention) {
                const mentionString = tagList.map(p => `<@${p.id}>`).join(' ');
                const botMsg = await message.channel.send(`📝 **รายชื่อที่บันทึก:** ${mentionString}`);

                const log = loadLog();
                log[botMsg.id] = tagList;
                saveLog(log);
                
                // 🔥 แก้ตรงนี้ (ใช้ botMsg)
                await addQueue(() => processSheetBatch(tagList, botMsg, config, false));
                
                if (message.deletable) await message.delete().catch(() => {});
            } else {
                await message.react('✅').catch(() => {});
                const log = loadLog();
                if (log[message.id]) return; 

                log[message.id] = tagList;
                saveLog(log);
                await addQueue(() => processSheetBatch(tagList, message, config, false));
            }
        } catch (error) { console.error('❌ messageCreate Error:', error); }
    });

    // 🗑️ ตรวจจับการลบข้อความ (คืนแต้ม)
    client.on('messageDelete', async (message) => {
        try {
            const log = loadLog();
            const tagList = log[message.id];
            if (!tagList) return; 

            delete log[message.id];
            saveLog(log);
            await addQueue(() => processSheetBatch(tagList, message, config, true));
        } catch (error) { console.error('❌ messageDelete Error:', error); }
    });

    // ✏️ ตรวจจับการแก้ไขข้อความ
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        try {
            if (!newMessage.guild || newMessage.author.bot) return;
            const log = loadLog();
            const oldList = log[newMessage.id] || [];
            const newList = getTagsFromContent(newMessage);

            const oldIds = oldList.map(x => x.id);
            const newIds = newList.map(x => x.id);

            const added = newList.filter(x => !oldIds.includes(x.id));
            const removed = oldList.filter(x => !newIds.includes(x.id));

            if (added.length === 0 && removed.length === 0) return;

            if (removed.length > 0) await addQueue(() => processSheetBatch(removed, newMessage, config, true));
            if (added.length > 0) await addQueue(() => processSheetBatch(added, newMessage, config, false));

            log[newMessage.id] = newList;
            saveLog(log);
        } catch (error) { console.error('❌ messageUpdate Error:', error); }
    });
}

// --- LOGIC ค้นหาชื่อคน ---
function getTagsFromContent(message) {
    if (!message || !message.content) return [];

    const words = message.content.trim().split(/\s+/);
    let tagList = [];
    let isAfterBy = false;

    for (const wordRaw of words) {
        const word = wordRaw.trim();
        let target = null;

        const mentionMatch = word.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            target = message.guild.members.cache.get(mentionMatch[1]);
        } else if (word.toLowerCase() === 'by') {
            isAfterBy = true;
            continue;
        } else if (isAfterBy && /^\d+$/.test(word)) {
            target = message.guild.members.cache.find(member => {
                const name = (
                    member.nickname ||
                    member.user.displayName ||
                    member.user.username ||
                    ""
                ).trim();

                const firstWord = name.trim().split(/\s+/)[0];
                return firstWord === word;
            });
        }

        if (target && !tagList.some(p => p.id === target.id)) {
            tagList.push({
                id: target.id,
                nickname: (target.nickname || target.user.displayName || target.user.username).trim(),
                username: target.user.username
            });
        }
    }

    return tagList;
}

function findUserRow(rows, person) {
    return rows.findIndex((r, idx) => {
        if (idx < 3 || !r[0]) return false;
        return r[0].toLowerCase() === person.nickname.toLowerCase();
    });
}

// --- Google Sheets ---
async function processSheetBatch(personList, message, config, isDelete = false) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = config.SPREADSHEET_ID;
        const sheetName = config.SHEET_NAME;

        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:G` });
        let rows = res.data.values || [];

        const ids = config.CHANNELS;
        const chId = message.channel.id;
        const channelMap = {
            [ids.TECH2]: { idx: 2, name: "TECH2" },
            [ids.KADEE]: { idx: 3, name: "คดี" },
            [ids.CAR]:   { idx: 5, name: "รถ" },
            [ids.EXAM]:  { idx: 6, name: "สอบ" }
        };

        const currentCh = channelMap[chId];
        if (!currentCh) return;

        const colIdx = currentCh.idx;
        const colName = currentCh.name;
        const amount = isDelete ? -1 : 1;
        const actionPrefix = isDelete ? "[-]" : "[+]";

        console.log(`-----------------------------------`);
        console.log(isDelete ? `🗑️ คืนแต้ม (${personList.length})` : `📊 เพิ่มแต้ม (${personList.length})`);

        for (const person of personList) {
            const isFirst = (person.id === personList[0].id);
            let rowIndex = findUserRow(rows, person);

            if (rowIndex !== -1) {
                let oldVal = parseInt(rows[rowIndex][colIdx] || '0');
                let newVal = oldVal + amount;
                rows[rowIndex][colIdx] = newVal.toString();

                console.log(`${actionPrefix} ${person.nickname} | ${colName}: ${oldVal} ➡️ ${newVal}`);

                if (isFirst && (chId === ids.KADEE || chId === ids.CAR)) {
                    let oldBonus = parseInt(rows[rowIndex][4] || '0');
                    let newBonus = oldBonus + amount;
                    rows[rowIndex][4] = newBonus.toString();

                    console.log(`Bonus: ${person.nickname} ${oldBonus} ➡️ ${newBonus}`);
                }
            } else if (!isDelete) {
                const newRow = [person.nickname, person.username, '0','0','0','0','0'];
                newRow[colIdx] = '1';
                if (isFirst && (chId === ids.KADEE || chId === ids.CAR)) newRow[4] = '1';
                rows.push(newRow);

                console.log(`🆕 ${person.nickname}`);
            }
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: rows }
        });

        console.log(`✅ อัปเดตสำเร็จ`);
        console.log(`-----------------------------------`);

    } catch (e) { console.error('❌ API Error:', e); }
}

module.exports = { initBot };
