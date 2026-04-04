require('dotenv').config();
// ✅ 1. เพิ่ม Events และ MessageFlags เข้ามาที่บรรทัดนี้
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, Events, MessageFlags } = require('discord.js');
const { initBot } = require('./bot.js');
const { initCommands } = require('./commands.js');
const { runManualCount } = require('./CountCase.js');
const { google } = require('googleapis');
const keys = require('./credentials.json');
const http = require('http');
const https = require('https');

// Spreadsheet ID ของไฟล์ Config
const CONFIG_SPREADSHEET_ID = '1YV_BIFiilxUM9XrW1cSYZTOgne1JnKoCXtRw7PUCCGs';

let config = { CHANNELS: {} };

/* =====================================================
    📡 LOAD CONFIG FROM GOOGLE SHEETS (Startup)
===================================================== */
async function loadConfigFromSheets() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const range = 'config!A2:B'; 

        const response = await sheets.spreadsheets.values.get({ 
            spreadsheetId: CONFIG_SPREADSHEET_ID, 
            range 
        });
        const rows = response.data.values;

        if (rows && rows.length) {
            let newConfig = { CHANNELS: {} };
            rows.forEach(row => {
                const key = row[0]?.trim();
                const value = row[1]?.trim();
                if (!key || !value) return;

                if (['TECH2', 'KADEE', 'CAR', 'EXAM'].includes(key)) {
                    newConfig.CHANNELS[key] = value;
                } else {
                    newConfig[key] = value;
                }
            });
            config = newConfig;
            console.log('✅ Load config from Google Sheets successfully!');
        }
    } catch (error) {
        console.error('⚠️ Load config error (using default):', error.message);
        try { config = require('./config.json'); } catch(e) {}
    }
}

/* =====================================================
    📡 UPDATE CONFIG TO GOOGLE SHEETS (Save)
===================================================== */
async function updateConfigInSheets(newConfig) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: { client_email: keys.client_email, private_key: keys.private_key },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        const dataForSheets = [
            ['SPREADSHEET_ID', newConfig.SPREADSHEET_ID],
            ['SHEET_NAME', newConfig.SHEET_NAME],
            ['TECH2', newConfig.CHANNELS.TECH2],
            ['KADEE', newConfig.CHANNELS.KADEE],
            ['CAR', newConfig.CHANNELS.CAR],
            ['EXAM', newConfig.CHANNELS.EXAM],
            ['GUILD_ID', process.env.GUILD_ID || ""]
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: CONFIG_SPREADSHEET_ID,
            range: 'config!A2:B',
            valueInputOption: 'USER_ENTERED',
            resource: { values: dataForSheets }
        });
        console.log('✅ Sync config to Google Sheets successfully!');
    } catch (err) {
        console.error('❌ Failed to sync config to Sheets:', err);
    }
}

/* =====================================================
    🤖 DISCORD CLIENT SETUP
===================================================== */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: ['MESSAGE', 'CHANNEL', 'GUILD_MEMBER'] 
});

async function startApp() {
    await loadConfigFromSheets(); 
    initBot(client, config);
    initCommands(client, config);
    client.login(process.env.DISCORD_TOKEN);
}

function createStatusEmbed(conf) {
    return new EmbedBuilder()
        .setTitle('⚠️ สถานะปัจจุบัน (การตั้งค่า):')
        .setDescription(`**Sheet ID:** \`${conf.SPREADSHEET_ID}\`\n**Sheet Name:** \`${conf.SHEET_NAME}\`\n\n**Channel ที่นับ:**\n• # เทค2: <#${conf.CHANNELS.TECH2}>\n• # คดีปกติ: <#${conf.CHANNELS.KADEE}>\n• # รถยอด: <#${conf.CHANNELS.CAR}>\n• # คุมสอบ: <#${conf.CHANNELS.EXAM}>`)
        .setColor('#f1c40f')
        .setFooter({ text: 'ดึงข้อมูลการตั้งค่าจาก Google Sheets เรียบร้อย' });
}

client.on('messageCreate', async (message) => {
    if (
        message.guild &&
        message.content === '!setup' &&
        message.member?.permissions?.has('Administrator')
    ) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_recount').setLabel('⭐ เริ่มนับข้อความเก่า').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_settings').setLabel('⚙️ ตั้งค่า').setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ 
            embeds: [createStatusEmbed(config)], 
            components: [row] 
        });
    }
});

client.on('interactionCreate', async (interaction) => {
    // ปุ่มนับข้อความเก่า
    if (interaction.isButton() && interaction.customId === 'start_recount') {
        // ✅ 2. เพิ่มจุดนี้เพื่อแก้ปัญหา Unknown Interaction (Code 10062)
        // และใช้ flags: [MessageFlags.Ephemeral] เพื่อแก้ Warning ตัวที่สอง
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            await runManualCount(interaction, config);
        } catch (e) { console.error(e); }
    }

    // ปุ่มตั้งค่า
    if (interaction.isButton() && interaction.customId === 'open_settings') {
        const modal = new ModalBuilder().setCustomId('settings_modal').setTitle('ตั้งค่าบอท');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('m_sheet_id').setLabel('Spreadsheet ID').setValue(config.SPREADSHEET_ID || "").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('m_sheet_name').setLabel('ชื่อชีต (Sheet Name)').setValue(config.SHEET_NAME || "").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('m_channels').setLabel('Channel IDs (คั่นด้วย , ) 4 ช่อง').setPlaceholder('ID_TECH2, ID_KADEE, ID_CAR, ID_EXAM').setValue(`${config.CHANNELS.TECH2 || ""}, ${config.CHANNELS.KADEE || ""}, ${config.CHANNELS.CAR || ""}, ${config.CHANNELS.EXAM || ""}`).setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
        );
        await interaction.showModal(modal);
    }

    // เมื่อกดยืนยันใน Modal
    if (interaction.isModalSubmit() && interaction.customId === 'settings_modal') {
        await interaction.deferUpdate();
        
        const newIds = interaction.fields.getTextInputValue('m_channels').split(',').map(id => id.trim());
        
        config.SPREADSHEET_ID = interaction.fields.getTextInputValue('m_sheet_id');
        config.SHEET_NAME = interaction.fields.getTextInputValue('m_sheet_name');
        config.CHANNELS = {
            "TECH2": newIds[0], "KADEE": newIds[1], "CAR": newIds[2], "EXAM": newIds[3]
        };

        await updateConfigInSheets(config);

        await interaction.editReply({ 
            embeds: [createStatusEmbed(config)], 
            components: [interaction.message.components[0]] 
        });
    }
});

/* =====================================================
    🌐 KEEP-ALIVE SERVER (สำหรับ Render Port Binding)
===================================================== */
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    console.log(`🤖 [${new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}] UptimeRobot: ตรวจสอบสถานะบอท (Ping!)`);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Port binding successful! Server listening on port ${PORT}`);
});

/* =====================================================
    🌐 SELF-PING (กระตุ้นตัวเองทุก 10 นาที)
===================================================== */
/* =====================================================
    🌐 SELF-PING (ใช้ตัวแปรอัตโนมัติจาก Render)
===================================================== */

const APP_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

setInterval(() => {
    https.get(APP_URL, (res) => {
        console.log(`🌐 [${new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}] Self-Ping: สถานะ ${res.statusCode}`);
    }).on('error', (err) => {
        console.error(`❌ Self-Ping Error: ${err.message}`);
    });
}, 5 * 60 * 1000);

startApp();
