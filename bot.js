const { google } = require('googleapis');
const keys = require('./credentials.json');

async function initBot(client, config) {

    // โหลดสมาชิกทั้งหมดเก็บไว้ใน Cache เพื่อให้ค้นหาด้วยเลขชื่อได้แม่นยำ
    client.once('ready', async () => {
        console.log('✅ Police Bot Online & Google API Ready!');
        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.members.fetch();
                console.log(`📥 Loaded members from guild: ${guild.name}`);
            } catch (err) {
                console.error(`❌ Failed to load members from ${guild.name}`, err);
            }
        }
    });

    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot || !message.guild) return;

            // 🚩 เช็คว่าห้องที่พิมพ์มา ตรงกับใน Config หรือไม่
            const ids = config.CHANNELS; // ดึง ID ห้องจาก config
            const allowedChannels = [ids.TECH2, ids.KADEE, ids.CAR, ids.EXAM];
            if (!allowedChannels.includes(message.channel.id)) return; // ถ้าไม่ใช่ห้องที่ตั้งค่าไว้ ให้หยุดทันที

            const words = message.content.trim().split(/\s+/);
            let tagList = [];
            let isManualMention = false;
            let isAfterBy = false;

            for (const rawWord of words) {
                const word = rawWord.trim();
                let target = null;

                // 1. ตรวจจับการแท็กตรง <@123>
                const mentionMatch = word.match(/^<@!?(\d+)>$/);
                if (mentionMatch) {
                    target = message.guild.members.cache.get(mentionMatch[1]);
                    if (target) isManualMention = true;
                }

                // 2. ถ้าเจอคำว่า by ให้เปิดโหมดรับตัวเลขถัดไป
                else if (word.toLowerCase() === 'by') {
                    isAfterBy = true;
                    continue; 
                }

                // 3. หลัง by ให้รับเลขทุกตัว เช่น by 02 01 00
                else if (isAfterBy && /^\d+$/.test(word)) {
                    target = message.guild.members.cache.find(member => {
                        const displayName = (member.nickname || member.user.displayName || "").trim();
                        const match = displayName.match(/^(\d+)/); // ดึงเลขหน้าชื่อมาเช็ค
                        return match && match[1] === word;
                    });
                }

                // เพิ่มลง tagList แบบไม่ซ้ำ
                if (target && !tagList.some(p => p.id === target.id)) {
                    tagList.push({
                        id: target.id,
                        nickname: (target.nickname || target.user.displayName || target.user.username).trim(),
                        username: target.user.username
                    });
                }
            }

            if (tagList.length === 0) return;

            // ตอบโต้ใน Discord
            if (!isManualMention) {
                const mentionString = tagList.map(p => `<@${p.id}>`).join(' ');
                await message.channel.send(`📝 **รายชื่อที่บันทึก:** ${mentionString}`);
                if (message.deletable) await message.delete().catch(() => {});
            } else {
                await message.react('✅').catch(() => {});
            }

            // บันทึกลง Google Sheets โดยใช้ config ที่ส่งมา
            await processSheetBatch(tagList, message, config);

        } catch (error) {
            console.error('❌ Bot Error:', error);
        }
    });
}

async function processSheetBatch(personList, message, config) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const spreadsheetId = config.SPREADSHEET_ID; // ใช้ ID จาก Google Sheets Config
        const sheetName = config.SHEET_NAME;
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:G` });
        let rows = response.data.values || [];

        const chId = message.channel.id;
        const ids = config.CHANNELS;
        let colIdx = -1;

        if (chId === ids.TECH2) colIdx = 2;
        if (chId === ids.KADEE) colIdx = 3;
        if (chId === ids.CAR) colIdx = 5;
        if (chId === ids.EXAM) colIdx = 6;

        for (const person of personList) {
            const isFirst = person.id === personList[0].id;
            let rowIndex = -1;

            // ค้นหาแถวที่ชื่อตรงกัน
            for (let r = 3; r < rows.length; r++) {
                if (!rows[r] || !rows[r][0]) continue;
                const nameInSheet = rows[r][0].trim().toLowerCase();
                const discordName = person.nickname.trim().toLowerCase();
                if (discordName === nameInSheet || discordName.includes(nameInSheet) || nameInSheet.includes(discordName)) {
                    rowIndex = r;
                    break;
                }
            }

            if (rowIndex !== -1) {
                if (colIdx !== -1) {
                    rows[rowIndex][colIdx] = (parseInt(rows[rowIndex][colIdx] || '0') + 1).toString();
                }
                // แต้ม Bonus สำหรับห้องคดีและห้องรถ
                if (isFirst && (chId === ids.KADEE || chId === ids.CAR)) {
                    rows[rowIndex][4] = (parseInt(rows[rowIndex][4] || '0') + 1).toString();
                }
            } else {
                // ถ้าไม่เจอชื่อ ให้เพิ่มแถวใหม่
                const newRow = [person.nickname, person.username, '', '', '', '', ''];
                if (colIdx !== -1) newRow[colIdx] = '1';
                if (isFirst && (chId === ids.KADEE || chId === ids.CAR)) newRow[4] = '1';
                rows.push(newRow);
            }
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: rows }
        });
        console.log(`📊 บันทึกสำเร็จ ${personList.length} รายชื่อ`);
    } catch (e) {
        console.error('❌ API Error:', e);
    }
}

module.exports = { initBot };