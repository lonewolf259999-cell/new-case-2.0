const { EmbedBuilder, WebhookClient } = require('discord.js');
const os = require('os');

// ใส่ Webhook URL ที่คุณให้มา
const webhookClient = new WebhookClient({ 
    url: 'https://discord.com/api/webhooks/1489467869224894595/uenLR9U-CbNdtQzBA3KEm4jM5JkNbqa6JsxYtYjOITtLR4q_4anP9mMmfzBRcPiq0XKt' 
});

const COLORS = {
    INFO: 0x3498db,    // Blue
    SUCCESS: 0x2ecc71, // Green
    WARN: 0xf1c40f,    // Yellow
    ERROR: 0xe74c3c,   // Red
    CRITICAL: 0x9b59b6 // Purple
};

class Logger {
    static async sendToDiscord(type, title, description, fields = []) {
        const embed = new EmbedBuilder()
            .setTitle(`${type === 'ERROR' ? '🚨' : '📡'} ${title}`)
            .setDescription(description)
            .setColor(COLORS[type] || COLORS.INFO)
            .setTimestamp()
            .setFooter({ text: 'Fresh Town System Monitor' });

        if (fields.length > 0) embed.addFields(fields);

        try {
            await webhookClient.send({ embeds: [embed] });
        } catch (err) {
            console.error('❌ Failed to send Webhook:', err.message);
        }
    }

    // แจ้งเตือนเมื่อบอท Online / Restart
    static async logReady(client) {
        const fields = [
            { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Platform', value: `${os.platform()} (${os.arch()})`, inline: true },
            { name: 'RAM Usage', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
        ];
        await this.sendToDiscord('SUCCESS', 'บอทเริ่มทำงาน (Online)', `บอท ${client.user.tag} พร้อมใช้งานแล้ว!`, fields);
    }

    // แจ้งเตือน Error ทั่วไป
    static async logError(error, context = 'Unknown') {
        console.error(`🚨 [${context}]`, error);
        const fields = [
            { name: 'Context', value: `\`${context}\``, inline: true },
            { name: 'Error Message', value: `\`\`\`${error.message || error}\`\`\`` }
        ];
        await this.sendToDiscord('ERROR', 'พบข้อผิดพลาด (Error)', 'เกิดปัญหาในการทำงานของระบบ', fields);
    }

    // แจ้งเตือนสถานะการเชื่อมต่อ (Shard)
    static async logConnection(status, details) {
        await this.sendToDiscord('WARN', 'สถานะการเชื่อมต่อ', `สถานะ: **${status}**\nรายละเอียด: ${details}`);
    }

    // แจ้งเตือน Quota หรือ API ค้าง
    static async logApiIssue(apiName, status) {
        await this.sendToDiscord('CRITICAL', 'API ISSUE', `บริการ **${apiName}** มีปัญหา!\nสถานะ: ${status}`);
    }
}

module.exports = Logger;