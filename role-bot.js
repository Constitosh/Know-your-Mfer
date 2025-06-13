import { Client, GatewayIntentBits, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';

// Load .env
dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const limit = pLimit(5);

// Updated POLICIES
const POLICIES = {
  tits: 'a4c45615825acae7c4937ee4d45d2ff9a29328084e2dc34bf4af37b2',
  otwo: '3bcc312ebe7cd9281ab3e3d641bf70f207012e539b0e6e7c3f1560d7',
  bob: '4552d6234e2a9cf2615220f9dbe1b233c4c2dccbc8d872dcae9a3795',
  mx: 'd2d5dc672cd07a17fec693688cfcea3f4afe6564000eb8d73337b8ae',
  twins: '4d78dc5ed9ea8cc940f8370e0d539fee3cb42d48b501762ba6acaf34',
  coins: '13f58336e1e11cea3ee956e0311a4ab81fc53de79400b0e019bff5c5'
};

// Initialize the Discord client
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let metadata02 = {};

async function load02Metadata() {
  try {
    const raw = await fs.readFile(path.join(__dirname, '02-metadata.json'), 'utf-8');
    metadata02 = JSON.parse(raw);
    console.log('✅ 02-metadata.json loaded successfully:', Object.keys(metadata02).length, 'entries');
  } catch (err) {
    console.error('❌ Error loading 02-metadata.json:', err.message);
    metadata02 = {};
  }
}

function isValidCardanoAddress(address) {
  return address && address.startsWith('addr1') && address.length >= 58 && /^[a-zA-Z0-9]+$/.test(address);
}

async function loadVerifiedData() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'verified.json'), 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ verified.json not found or invalid:', err.message);
    return {};
  }
}

async function getAssets(wallet) {
  if (!isValidCardanoAddress(wallet)) {
    console.warn(`⚠️ Invalid Cardano address: ${wallet}`);
    return [];
  }
  return limit(async () => {
    wallet = wallet.trim();
    const baseUrl = 'https://cardano-mainnet.blockfrost.io/api/v0/addresses';
    let allAssets = [];
    try {
      const addressUrl = `${baseUrl}/${encodeURIComponent(wallet)}`;
      console.log(`🔍 Checking address existence at ${addressUrl}`);
      const addressRes = await axios.get(addressUrl, { headers: { project_id: BLOCKFROST_API_KEY } });
      console.log(`📌 Address check (Status: ${addressRes.status}):`, JSON.stringify(addressRes.data, null, 2));
      const assetsFromAddress = addressRes.data.amount.filter(asset => asset.unit !== 'lovelace');
      allAssets = assetsFromAddress.map(asset => ({
        unit: asset.unit,
        quantity: parseInt(asset.quantity),
        policy_id: asset.unit.slice(0, 56),
        asset_name: Buffer.from(asset.unit.slice(56), 'hex').toString('utf8')
      }));
      console.log(`📊 Total assets found from address: ${allAssets.length}`);
    } catch (addressErr) {
      const status = addressErr.response?.status || 'Unknown';
      const message = addressErr.response?.data?.message || addressErr.message;
      console.warn(`⚠️ Address ${wallet} not found: ${status} - ${message}`);
    }
    console.log(`📊 Total assets found for wallet ${wallet}: ${allAssets.length}`);
    return allAssets;
  });
}

function getMferRole(count) {
  if (count >= 250) return 'God';
  if (count >= 125) return '42% God';
  if (count >= 75) return 'Part God';
  if (count >= 50) return 'Lord of DN';
  if (count >= 25) return 'Glorious Mfer';
  if (count >= 10) return 'Big Ol’ Bumbum Mfer';
  if (count >= 5) return 'Incredible Mfer';
  if (count >= 4) return 'Fancy Mfer';
  if (count >= 3) return 'Impressive Mfer';
  if (count >= 2) return 'Semi-Impressive Mfer';
  if (count >= 1) return 'Mfer';
  if (count = 0) return 'No Mfer';
  return null;
}

function hasRainbowStampTraits(assets) {
  const needed = new Set(['Green', 'Blue', 'Navy', 'Red', 'Purple', 'Yellow']);
  for (const asset of assets) {
    const key = Object.keys(metadata02).find(k => k.endsWith(asset.asset_name));
    if (key) {
      const entry = metadata02[key];
      if (entry && entry['Stamp Color']) {
        needed.delete(entry['Stamp Color']);
      }
    }
    if (needed.size === 0) {
      console.log(`✅ Rainbow stamp colors complete for asset ${asset.asset_name}`);
      return true;
    }
  }
  console.log(`⚠️ Missing rainbow stamp colors: ${Array.from(needed).join(', ')}`);
  return false;
}

async function saveRolesData(rolesData) {
  try {
    await fs.writeFile(
      path.join(__dirname, 'roles.json'),
      JSON.stringify(rolesData, null, 2),
      'utf-8'
    );
    console.log('💾 roles.json saved successfully');
  } catch (err) {
    console.error('❌ Error saving roles.json:', err.message);
  }
}

let isAssigningRoles = false;
async function assignRoles() {
  if (isAssigningRoles) {
    console.log('⏳ Role assignment already in progress, skipping');
    return;
  }
  isAssigningRoles = true;
  try {
    const verified = await loadVerifiedData();
    const guild = await client.guilds.fetch(GUILD_ID);
    const rolesData = {};

    for (const [discordId, wallets] of Object.entries(verified)) {
      console.log(`🔍 Processing user ${discordId} with wallets: ${JSON.stringify(wallets)}`);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        console.log(`⚠️ Member ${discordId} not found in guild`);
        continue;
      }

      const walletList = Array.isArray(wallets) ? wallets : [wallets];
      let allAssets = [];
      for (const wallet of walletList) {
        const assets = await getAssets(wallet);
        allAssets.push(...assets);
      }

      if (allAssets.length === 0) {
        console.log(`⚠️ No assets found for wallets ${walletList.join(', ')} for user ${discordId}.`);
        continue;
      }

      const policyMap = Object.fromEntries(Object.keys(POLICIES).map(k => [k, []]));
      for (const asset of allAssets) {
        for (const [label, policy] of Object.entries(POLICIES)) {
          if (asset.policy_id === policy) policyMap[label].push(asset);
        }
      }

      const count02mx = policyMap.otwo.length + policyMap.mx.length;
      const mferRole = getMferRole(count02mx);
      const rolesToAdd = mferRole ? [mferRole] : [];

      if (policyMap.tits.length >= 1) rolesToAdd.push('TiTs');
      if (policyMap.twins.length >= 1) rolesToAdd.push('Hoodros Au Revoir');
      if (policyMap.coins.length >= 1) rolesToAdd.push('Dedicated Mfer');
      if (policyMap.bob.length >= 1) rolesToAdd.push('Back Of Bills');
      if (policyMap.mx.length >= 1) rolesToAdd.push('Sicario');
      if (hasRainbowStampTraits(policyMap.otwo)) rolesToAdd.push('Xesserson Rainbow');

      rolesData[discordId] = {
        discordId,
        assets: Object.fromEntries(
          Object.entries(policyMap).map(([policy, assets]) => [
            policy,
            { count: assets.length, names: assets.map(a => a.asset_name) }
          ])
        ),
        assignedRoles: rolesToAdd
      };

      const allRoleNames = [
        'Mfer', 'Semi-Impressive Mfer', 'Impressive Mfer', 'Fancy Mfer',
        'Incredible Mfer', 'Big Ol’ Bumbum Mfer', 'Glorious Mfer', 'Lord of DN',
        'Part God', '42% God', 'God', 'TiTs', 'Hoodros Au Revoir',
        'Dedicated Mfer', 'Back Of Bills', 'Sicario', 'Xesserson Rainbow'
      ];

      const guildRoles = await guild.roles.fetch();
      const rolesToAssign = rolesToAdd
        .map(name => {
          const role = guildRoles.find(r => r.name === name);
          if (!role) console.warn(`⚠️ Role ${name} not found in guild`);
          return role;
        })
        .filter(Boolean);

      const rolesToRemove = member.roles.cache.filter(r => allRoleNames.includes(r.name) && !rolesToAdd.includes(r.name));
      await member.roles.remove(rolesToRemove);
      for (const role of rolesToAssign) {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role);
          console.log(`✅ Assigned role ${role.name} to ${discordId}`);
        }
      }
    }

    await saveRolesData(rolesData);
  } catch (err) {
    console.error('❌ Error in assignRoles:', err.message);
  } finally {
    isAssigningRoles = false;
  }
}

client.once('ready', async () => {
  console.log(`🤖 Role sync bot online as ${client.user.tag}`);
  if (!DISCORD_BOT_TOKEN || !GUILD_ID || !BLOCKFROST_API_KEY) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
  }
  await load02Metadata();
  const command = new SlashCommandBuilder()
    .setName('getrole')
    .setDescription('Assigns roles based on your verified Cardano wallet assets');
  await client.application.commands.create(command, GUILD_ID);
  await assignRoles();
  setInterval(assignRoles, 24 * 60 * 60 * 1000); // Changed to 24 hours
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() || interaction.commandName !== 'getrole') return;
  await interaction.deferReply({ ephemeral: true });
  try {
    const discordId = interaction.user.id;
    const verified = await loadVerifiedData();
    if (!verified[discordId]) {
      await interaction.editReply('No wallet found. Please verify your Cardano wallet first. Type in /verify to get started.');
      return;
    }
    await assignRoles();
    await interaction.editReply('Roles have been updated based on your wallet assets.');
  } catch (err) {
    console.error('❌ Error processing /getrole command:', err.message);
    await interaction.editReply('An error occurred while processing your roles. Please try again later.');
  }
});

client.login(DISCORD_BOT_TOKEN);

import http from 'http';

const PORT = 3002;

// UptimeRobot ping server
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive!\n');
}).listen(PORT, () => {
  console.log(`🌐 Ping server running on port ${PORT}`);
});
