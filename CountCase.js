const { google } = require('googleapis');
const keys = require('./credentials.json');

async function runManualCount(interaction, config) { 
    
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    console.log('-----------------------------------');
    console.log('🧹 เริ่มประมวลผล Manual Recount ...');

    try {
        const { client, guild } = interaction;

        // ✅ โหลด member ทั้งหมด (ใช้ cache)
        await guild.members.fetch();

        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        const spreadsheetId = config.SPREADSHEET_ID;
        const sheetName = config.SHEET_NAME;

        // กัน Google ยิงถี่
        await new Promise(r => setTimeout(r, 500));

        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!C4:G`,
        });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:G`,
        });

        let rows = response.data.values || [];
        let totalMsgCount = 0;

        const processedMessages = new Set();
        const channelIds = config.CHANNELS;

        // ✅ เคลียร์ค่าคะแนนเก่า
        for (let i = 3; i < rows.length; i++) {
            if (rows[i]) {
                for (let col = 2; col <= 6; col++) {
                    rows[i][col] = "";
                }
            }
        }

        for (const [key, chId] of Object.entries(channelIds)) {
            const channel = await client.channels.fetch(chId).catch(() => null);
            if (!channel) continue;

            let lastId = null;
            let hasMore = true;

            while (hasMore) {
                const messages = await channel.messages.fetch({
                    limit: 100,
                    before: lastId || undefined
                });

                if (messages.size === 0) break;

                for (const msg of messages.values()) {

                    // ✅ กันซ้ำ
                    if (processedMessages.has(msg.id)) continue;
                    processedMessages.add(msg.id);

                    let tagList = [];

                    // ======================
                    // ✅ ดึงจาก mention
                    // ======================
                    const mentions = msg.content.match(/<@!?(\d+)>/g);
                    if (mentions) {
                        for (const m of mentions) {
                            const uId = m.match(/\d+/)[0];
                            const member = guild.members.cache.get(uId);
                            if (!member) continue;

                            const nick = (member.nickname || member.user.displayName || "").trim();

                            // 👉 ดึงเลขหน้าชื่อ
                            const match = nick.match(/^(\d{1,5})/);
                            if (!match) continue;

                            const code = match[1];

                            if (!tagList.includes(code)) {
                                tagList.push(code);
                            }
                        }
                    }

                    // ======================
                    // ✅ ดึงจากเลขที่พิมเอง
                    // ======================
                    if (!msg.author.bot) {
                        const words = msg.content.split(/\s+/);
                        for (const word of words) {
                            if (/^\d{1,5}$/.test(word)) {
                                if (!tagList.includes(word)) {
                                    tagList.push(word);
                                }
                            }
                        }
                    }

                    // ======================
                    if (tagList.length > 0) {
                        updateRows(rows, tagList, chId, channelIds);
                    }
                }

                totalMsgCount += messages.size;

                // แจ้ง progress
                if (totalMsgCount % 1000 === 0) {
                    await interaction.editReply(
                        `⏳ กำลังนับ... ${totalMsgCount.toLocaleString()} ข้อความ`
                    ).catch(() => null);
                }

                lastId = messages.last()?.id;

                // ✅ กัน rate limit Discord
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // ✅ บันทึกลง Google Sheets
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: rows }
        });

        await interaction.editReply(
            `✅ เสร็จสิ้น! ${totalMsgCount.toLocaleString()} ข้อความ`
        );

        console.log(`✅ สำเร็จ: ${totalMsgCount}`);
        console.log('-----------------------------------');

    } catch (error) {
        console.error(error);
        await interaction.editReply("❌ Error");
    }
}

// ======================
// ✅ อัปเดตคะแนน
// ======================
function updateRows(rows, tagList, chId, ids) {

    let colIdx = -1;
    if (chId === ids.TECH2) colIdx = 2;
    if (chId === ids.KADEE) colIdx = 3;
    if (chId === ids.CAR) colIdx = 5;
    if (chId === ids.EXAM) colIdx = 6;

    tagList.forEach((code) => {

        let rowIndex = rows.findIndex((r, i) => {
            if (i < 3 || !r[0]) return false;

            // 🔥 จุดสำคัญ (แก้ bug ชนเลข)
            return r[0].toString().split(" ")[0] === code;
        });

        if (rowIndex !== -1) {
            let val = parseInt(rows[rowIndex][colIdx]) || 0;
            rows[rowIndex][colIdx] = (val + 1).toString();
        } else {
            let newRow = [code, "", "", "", "", "", ""];
            newRow[colIdx] = "1";
            rows.push(newRow);
        }
    });
}

module.exports = { runManualCount };
