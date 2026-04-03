const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runManualCount } = require('./CountCase.js'); 

// เพิ่ม parameter config เข้ามาในฟังก์ชัน
async function initCommands(client, config) { 
    // 1. ลงทะเบียนคำสั่งตอนบอทออนไลน์
    client.once('ready', async (c) => {
        const commands = [
            new SlashCommandBuilder()
                .setName('de')
                .setDescription('ลบข้อความ 20 ข้อความ')
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
            
            new SlashCommandBuilder()
                .setName('recount')
                .setDescription('ล้างค่าใน Sheets และเริ่มนับใหม่จาก 100 ข้อความล่าสุด')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), 
        ].map(cmd => cmd.toJSON());

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            // ใช้ GUILD_ID จาก config ที่ดึงมาจาก Sheets หรือ process.env ก็ได้
            const guildId = process.env.GUILD_ID || config.GUILD_ID; 
            
            await rest.put(
                Routes.applicationGuildCommands(c.user.id, guildId),
                { body: commands }
            );
            console.log('✅ Registered Slash Commands (/de, /recount)');
        } catch (e) { console.error('❌ Slash Command Error:', e); }
    });

    // 2. รอฟังการใช้คำสั่ง Slash
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        // คำสั่ง /de
        if (interaction.commandName === 'de') {
            try {
                const deleted = await interaction.channel.bulkDelete(20, true);
                await interaction.reply({ content: `🗑️ ลบแล้ว ${deleted.size} ข้อความ`, ephemeral: true });
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: '❌ ไม่สามารถลบข้อความได้ (อาจเป็นข้อความที่เก่าเกิน 14 วัน)', ephemeral: true });
            }
        }

        // คำสั่ง /recount
        if (interaction.commandName === 'recount') {
            // ส่ง interaction และ config ไปให้ runManualCount ใช้งาน
            await runManualCount(interaction, config);
        }
    });
}

module.exports = { initCommands };