const { google } = require('googleapis');
const keys = require('./credentials.json');

// นำ const config = require('./config.json'); ออกแล้ว

async function runManualCount(interaction, config) { // เพิ่ม parameter config
    await interaction.deferReply({ ephemeral: true });
    console.log('🧹 เริ่มประมวลผลข้อมูลจาก Google Sheets Config...');

    try {
        const { client, guild } = interaction;
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // ใช้ค่าจาก config ที่ส่งมาจาก Google Sheets (ผ่าน index.js)
        const spreadsheetId = config.SPREADSHEET_ID;
        const sheetName = config.SHEET_NAME;

        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!C4:G`, 
        });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!A:G`,
        });

        let rows = response.data.values || [];
        const userCache = new Map(); 

        for (let i = 3; i < rows.length; i++) {
            if (rows[i]) {
                for (let col = 2; col <= 6; col++) {
                    if (rows[i].length > col) rows[i][col] = "";
                }
            }
        }

        const channelIds = config.CHANNELS;
        for (const [key, chId] of Object.entries(channelIds)) {
            const channel = await client.channels.fetch(chId).catch(() => null);
            if (!channel) continue;

            let lastId = null;
            let hasMore = true;
            let count = 0; // เพิ่มตัวนับเพื่อจำกัดจำนวนข้อความ (ถ้าต้องการ)

            while (hasMore) {
                const messages = await channel.messages.fetch({ limit: 100, before: lastId || undefined });
                if (messages.size === 0) break;

                for (const msg of messages.values()) {
                    let tagList = [];

                    // --- [ส่วนที่ 1: ตรวจจับการแท็ก] ---
                    const mentions = msg.content.match(/<@!?(\d+)>/g);
                    if (mentions) {
                        for (const m of mentions) {
                            const uId = m.match(/\d+/)[0];
                            let userData = userCache.get(uId);
                            if (!userData) {
                                try {
                                    const user = await client.users.fetch(uId);
                                    const memberInGuild = await guild.members.fetch(uId).catch(() => null);
                                    
                                    userData = {
                                        id: uId,
                                        nickname: memberInGuild ? (memberInGuild.nickname || user.displayName) : user.username,
                                        username: user.username
                                    };
                                    userCache.set(uId, userData);
                                } catch (e) { continue; }
                            }
                            
                            if (userData) {
                                if (!tagList.some(p => p.id === userData.id)) {
                                    tagList.push(userData);
                                }
                            }
                        }
                    }

                    // --- [ส่วนที่ 2: ตรวจจับรหัสเลข] ---
                    if (!msg.author.bot) {
                        const words = msg.content.split(/\s+/);
                        for (const word of words) {
                            if (/^\d{1,5}$/.test(word)) {
                                const target = guild.members.cache.find(m => {
                                    const nick = (m.nickname || m.user.displayName || "").trim();
                                    return nick === word || nick.startsWith(`${word} `) || nick.startsWith(`${word}[`);
                                });
                                if (target) {
                                    if (!tagList.some(p => p.id === target.id)) {
                                        tagList.push({
                                            id: target.id,
                                            nickname: (target.nickname || target.user.displayName).trim(),
                                            username: target.user.username
                                        });
                                    }
                                }
                            }
                        }
                    }

                    if (tagList.length > 0) {
                        updateRowsWithSmartMatch(rows, tagList, chId, channelIds);
                    }
                }
                lastId = messages.last()?.id;
                if (messages.size < 100) hasMore = false;
            }
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: rows }
        });

        await interaction.editReply(`📊 **นับยอดเสร็จสิ้น!**\n \`${sheetName}\``);

    } catch (error) {
        console.error('❌ Error in CountCase:', error);
        await interaction.editReply("❌ **เกิดข้อผิดพลาด** โปรดตรวจสอบสิทธิ์การเข้าถึง Sheets");
    }
}

function updateRowsWithSmartMatch(rows, tagList, currentChId, ids) {
    let colIdx = -1;
    if (currentChId === ids.TECH2) colIdx = 2; 
    if (currentChId === ids.KADEE) colIdx = 3; 
    if (currentChId === ids.CAR) colIdx = 5;   
    if (currentChId === ids.EXAM) colIdx = 6;  

    tagList.forEach((person, index) => {
        const isFirst = (index === 0);
        let rowIndex = rows.findIndex((r, idx) => {
            if (idx < 3 || !r[0]) return false;
            const sName = r[0].toString().trim().toLowerCase();
            const dNick = (person.nickname || "").toLowerCase();
            const dUser = (person.username || "").toLowerCase();
            
            return dNick === sName || dNick.includes(sName) || dUser === sName || dUser.includes(sName) || sName.includes(dUser);
        });

        if (rowIndex !== -1) {
            if (colIdx !== -1) {
                let currentVal = parseInt(rows[rowIndex][colIdx]) || 0;
                rows[rowIndex][colIdx] = (currentVal + 1).toString();
            }
            if (isFirst && (currentChId === ids.KADEE || currentChId === ids.CAR)) {
                let currentBonus = parseInt(rows[rowIndex][4]) || 0;
                rows[rowIndex][4] = (currentBonus + 1).toString();
            }
        } else {
            let finalName = person.nickname || person.username;
            let newRow = [finalName, person.username, "", "", "", "", ""];
            if (colIdx !== -1) newRow[colIdx] = "1";
            if (isFirst && (currentChId === ids.KADEE || currentChId === ids.CAR)) newRow[4] = "1";
            rows.push(newRow);
        }
    });
}

module.exports = { runManualCount };