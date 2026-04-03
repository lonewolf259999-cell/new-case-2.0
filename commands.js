const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Events, MessageFlags } = require('discord.js'); // ✅ 1. เพิ่ม MessageFlags ตรงนี้
const { runManualCount } = require('./CountCase.js'); 

// เพิ่ม parameter config เข้ามาในฟังก์ชัน
async function initCommands(client, config) { 
    // 1. ลงทะเบียนคำสั่งตอนบอทออนไลน์
    client.once(Events.ClientReady, async (c) => {
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
                // ✅ 2. แก้จาก ephemeral: true เป็น flags: [MessageFlags.Ephemeral]
                await interaction.reply({ 
                    content: `🗑️ ลบแล้ว ${deleted.size} ข้อความ`, 
                    flags: [MessageFlags.Ephemeral] 
                });
            } catch (err) {
                console.error(err);
                // ✅ 3. แก้ตรงนี้ด้วยเหมือนกัน
                await interaction.reply({ 
                    content: '❌ ไม่สามารถลบข้อความได้ (อาจเป็นข้อความที่เก่าเกิน 14 วัน)', 
                    flags: [MessageFlags.Ephemeral] 
                });
            }
        }

        // คำสั่ง /recount
        if (interaction.commandName === 'recount') {
            // ✅ 4. เพิ่มการขอเวลานอก (deferReply) เพื่อกัน Error "Unknown Interaction"
            // เพราะการนับข้อความ (recount) มักใช้เวลานานเกิน 3 วินาที
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            await runManualCount(interaction, config);
        }
    });
}

module.exports = { initCommands };
