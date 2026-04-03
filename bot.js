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

// queue กันชน API
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

    // 📩 messageCreate
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

                await addQueue(() => processSheetBatch(tagList, botMsg, config, false, null, tagList[0]));

                if (message.deletable) await message.delete().catch(() => {});
            } else {
                await message.react('✅').catch(() => {});

                const log = loadLog();
                if (log[message.id]) return;

                log[message.id] = tagList;
                saveLog(log);

                await addQueue(() => processSheetBatch(tagList, message, config, false, null, tagList[0]));
            }
        } catch (error) {
            console.error('❌ messageCreate Error:', error);
        }
    });

    // 🗑️ messageDelete
    client.on('messageDelete', async (message) => {
        try {
            if (message.partial) {
                try { await message.fetch(); } catch { return; }
            }

            const log = loadLog();
            const oldList = log[message.id];
            if (!oldList) return;

            delete log[message.id];
            saveLog(log);

            await addQueue(() => processSheetBatch(oldList, message, config, true, oldList[0], null));
        } catch (error) {
            console.error('❌ messageDelete Error:', error);
        }
    });

    // ✏️ messageUpdate
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        try {
            if (newMessage.partial) {
                try { await newMessage.fetch(); } catch { return; }
            }
            if (!newMessage.guild || newMessage.author?.bot) return;

            const log = loadLog();
            const oldList = log[newMessage.id] || [];
            const newList = getTagsFromContent(newMessage);

            const oldIds = oldList.map(x => x.id);
            const newIds = newList.map(x => x.id);

            const added = newList.filter(x => !oldIds.includes(x.id));
            const removed = oldList.filter(x => !newIds.includes(x.id));

            if (added.length === 0 && removed.length === 0) return;

            // คนแรกเก่าและใหม่
            const oldFirst = oldList[0] || null;
            const newFirst = newList[0] || null;

            // ลด Bonus ของคนแรกเก่าเฉพาะถูกลบจริง ๆ
            if (oldFirst && (oldFirst.id !== newFirst?.id)) {
                const stillExists = newList.find(p => p.id === oldFirst.id);
                if (!stillExists) {
                    await addQueue(() => processSheetBatch([oldFirst], newMessage, config, true, oldFirst, null));
                }
            }

            // เพิ่ม Bonus ให้คนแรกใหม่ ถ้าเปลี่ยน
            if (newFirst && (newFirst.id !== oldFirst?.id)) {
                await addQueue(() => processSheetBatch([newFirst], newMessage, config, false, null, newFirst));
            }

            // ปรับคะแนน D ของคนที่เพิ่ม/ลบปกติ
            if (removed.length > 0)
                await addQueue(() => processSheetBatch(removed, newMessage, config, true));
            if (added.length > 0)
                await addQueue(() => processSheetBatch(added, newMessage, config, false));

            log[newMessage.id] = newList;
            saveLog(log);

        } catch (error) {
            console.error('❌ messageUpdate Error:', error);
        }
    });
}

// ------------------------------
// processSheetBatch
async function processSheetBatch(personList, message, config, isDelete = false, oldFirst = null, newFirst = null) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = config.SPREADSHEET_ID;
        const sheetName = config.SHEET_NAME;

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:G`
        });
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

        // --- Bonus ลด ของคนแรกเก่า ---
        if (oldFirst && (chId === ids.KADEE || chId === ids.CAR)) {
            const idx = findUserRow(rows, oldFirst);
            if (idx !== -1) {
                let val = parseInt(rows[idx][4] || '0');
                rows[idx][4] = (val - 1).toString();
                console.log(`Bonus ลด: ${oldFirst.nickname} ${val} ➡️ ${rows[idx][4]}`);
            }
        }

        // --- Bonus เพิ่ม ของคนแรกใหม่ ---
        if (newFirst && (chId === ids.KADEE || chId === ids.CAR)) {
            const idx = findUserRow(rows, newFirst);
            if (idx !== -1) {
                let val = parseInt(rows[idx][4] || '0');
                rows[idx][4] = (val + 1).toString();
                console.log(`Bonus เพิ่ม: ${newFirst.nickname} ${val} ➡️ ${rows[idx][4]}`);
            }
        }

        // --- ปรับคะแนน D ปกติของคนใน personList ---
        for (const person of personList) {
            let rowIndex = findUserRow(rows, person);
            if (rowIndex !== -1) {
                let oldVal = parseInt(rows[rowIndex][colIdx] || '0');
                let newVal = oldVal + amount;
                rows[rowIndex][colIdx] = newVal.toString();
                console.log(`${actionPrefix} ${person.nickname} | ${colName}: ${oldVal} ➡️ ${newVal}`);
            } else if (!isDelete) {
                const newRow = [person.nickname, person.username, '0','0','0','0','0'];
                newRow[colIdx] = '1';
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
    } catch (e) {
        console.error('❌ API Error:', e);
    }
}

module.exports = { initBot };
