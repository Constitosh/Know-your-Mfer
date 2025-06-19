// Discord bot for Cardano wallet verification with /hash command
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  InteractionType,
  InteractionResponseType
} from 'discord.js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from Replit Secrets
dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;
const PORT = process.env.PORT || 3001;

// Validate environment variables
if (!DISCORD_BOT_TOKEN || !CLIENT_ID || !BLOCKFROST_API_KEY) {
  console.error('❌ Missing environment variables in Replit Secrets: DISCORD_BOT_TOKEN, CLIENT_ID, or BLOCKFROST_API_KEY');
  process.exit(1);
}

// Set up paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express server
const app = express();
app.get('/', (req, res) => res.send('Verify bot is running.'));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT} - Access at Replit URL`));

// Initialize Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const verificationMap = new Map();

// Generate random ADA amount (0.1 to 0.5 ADA)
function generateRandomAdaAmount() {
  return parseFloat((Math.random() * 0.99 + 0.5).toFixed(6));
}

// Validate transaction hash (64-character hexadecimal)
function isValidTxHash(txHash) {
  return /^[0-9a-fA-F]{64}$/.test(txHash);
}

// Verify Cardano transaction
async function verifyTransaction(txHash, wallet) {
  if (!isValidTxHash(txHash)) {
    console.error('❌ Invalid transaction hash format:', txHash);
    return { success: false, message: 'Invalid transaction hash format (must be 64 hex characters).' };
  }

  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(
        `https://cardano-mainnet.blockfrost.io/api/v0/txs/${txHash}/utxos`,
        { headers: { project_id: BLOCKFROST_API_KEY } }
      );

      const { inputs, outputs } = response.data;

      // Check if wallet is involved (sender or receiver)
      const isSender = inputs.some(i => i.address === wallet);
      const isReceiver = outputs.some(o => o.address === wallet);

      console.log(`Attempt ${attempt}: Sender: ${isSender}, Receiver: ${isReceiver}, Wallet: ${wallet}`);

      if (isSender || isReceiver) {
        console.log(`✅ Transaction ${txHash} verified for wallet ${wallet}`);
        return { success: true, message: 'Transaction verified successfully.' };
      } else {
        return { success: false, message: 'Wallet not found in transaction inputs or outputs.' };
      }
    } catch (err) {
      const status = err.response?.status;
      const errorMsg = err.response?.data?.message || err.message;
      console.error(`❌ Attempt ${attempt} failed: Status ${status}, Error: ${errorMsg}`);

      if (status === 429 && attempt < maxRetries) {
        console.log(`Rate limit hit, retrying after ${5 * attempt} seconds...`);
        await new Promise(res => setTimeout(res, 5000 * attempt));
        continue;
      }
      if (status === 404 && attempt < maxRetries) {
        console.log(`Transaction not found, retrying after 30 seconds...`);
        await new Promise(res => setTimeout(res, 30000));
        continue;
      }
      if (status === 400) {
        return { success: false, message: 'Invalid transaction hash.' };
      }
      if (status === 403) {
        return { success: false, message: 'Invalid Blockfrost API key.' };
      }
      return { success: false, message: `API error: ${errorMsg}` };
    }
  }
  return { success: false, message: 'Transaction not found after retries. Wait longer and try again.' };
}

// Store verified user
async function storeVerifiedUser(discordId, wallet) {
  const dbPath = path.join(__dirname, 'verified.json');
  let existing = {};

  try {
    const data = await fs.readFile(dbPath, 'utf-8');
    if (data.trim() === '') {
      console.log('⚠️ verified.json is empty, initializing with {}');
      existing = {};
    } else {
      existing = JSON.parse(data);
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.message.includes('Unexpected end of JSON input')) {
      console.log('⚠️ verified.json not found or invalid, initializing with {}');
      existing = {};
    } else {
      console.error('❌ Failed to read verified.json:', err.message);
      throw err;
    }
  }

  if (!existing[discordId]) existing[discordId] = [];
  if (!existing[discordId].includes(wallet)) existing[discordId].push(wallet);

  try {
    await fs.writeFile(dbPath, JSON.stringify(existing, null, 2));
    console.log(`✅ Stored verified wallet for user ${discordId}`);
  } catch (err) {
    console.error('❌ Failed to write verified.json:', err.message);
    throw err;
  }
}

// Register slash commands
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag || 'unknown'}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Mfer verification')
      .addStringOption(opt =>
        opt.setName('wallet').setDescription('Copy/Paste your Cardano wallet address').setRequired(true)),
    new SlashCommandBuilder()
      .setName('hash')
      .setDescription('Submit transaction hash')
      .addStringOption(opt =>
        opt.setName('txhash').setDescription('Transaction hash').setRequired(true))
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Registered commands: /verify, /hash');
  } catch (err) {
    console.error('❌ Command registration failed:', err.message, err.stack);
    process.exit(1);
  }
});

// Handle interactions
client.on('interactionCreate', async interaction => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;

  const discordId = interaction.user.id;

  if (interaction.commandName === 'verify') {
    const wallet = interaction.options.getString('wallet');

    if (!wallet?.startsWith('addr1')) {
      try {
        await interaction.reply({
          content: '❌ Invalid wallet address. Must start with "addr1".',
          flags: 64 // Ephemeral flag
        });
      } catch (err) {
        console.error('❌ Reply failed:', err.message);
      }
      return;
    }

    const amount = generateRandomAdaAmount();
    verificationMap.set(discordId, { wallet, amount });

    try {
      await interaction.reply({
        content:
`🚨 Attention, potential Mfer detected 🚨\n\nWelcome to DEEZ bot\n\na fully trustless, partially credible, and deeply unnecessary branch of financial surveillance excellence.\n\nTo continue, please submit to KYM: Know Your Mfer.\n\nYour wallet may be scanned, and your assets archived — but it’s all for your own protection.\n\n

🔐 To verify:\n
1. Send **${amount} ADA** from \`${wallet}\` to itself.
2. Wait 30 seconds for the transaction to confirm.
3. Submit the transaction hash with \`/hash\`.`,
        flags: 64 // Ephemeral flag
      });

      setTimeout(async () => {
        try {
          await interaction.followUp({
            content: '✏️ Submit your transaction hash now, type the command:\n `/hash`',
            flags: 64 // Ephemeral flag
          });
        } catch (err) {
          console.error('❌ Follow-up failed:', err.message);
        }
      }, 30000); // Increased to 30 seconds

      setTimeout(async () => {
        if (verificationMap.has(discordId)) {
          verificationMap.delete(discordId);
          try {
            await interaction.followUp({
              content: '⏱ Verification timed out. Retry with `/verify`.',
              flags: 64 // Ephemeral flag
            });
          } catch (err) {
            console.error('❌ Timeout follow-up failed:', err.message);
          }
        }
      }, 15 * 60 * 1000);
    } catch (err) {
      console.error('❌ Reply failed:', err.message);
      try {
        await interaction.reply({
          content: '❌ An error occurred. Try again later.',
          flags: 64 // Ephemeral flag
        });
      } catch (replyErr) {
        console.error('❌ Failed to send error reply:', replyErr.message);
      }
    }
  }

  if (interaction.commandName === 'hash') {
    const txHash = interaction.options.getString('txhash');

    if (!verificationMap.has(discordId)) {
      try {
        await interaction.reply({
          content: '❌ No verification in progress. Start with `/verify`.',
          flags: 64 // Ephemeral flag
        });
      } catch (err) {
        console.error('❌ Reply failed:', err.message);
      }
      return;
    }

    const { wallet, amount } = verificationMap.get(discordId);

    try {
      await interaction.reply({
        content: `🔍 Verifying transaction \`${txHash}\`...`,
        flags: 64 // Ephemeral flag
      });

      const { success, message } = await verifyTransaction(txHash, wallet);

      if (success) {
        await storeVerifiedUser(discordId, wallet);
        verificationMap.delete(discordId);
        try {
          await interaction.followUp({
            content: `✅ Wallet \`${wallet}\` \nverified, congrats! \n\nUse \`/getrole\` to assign your role and proof you are a Mfer.`,
            flags: 64 // Ephemeral flag
          });
        } catch (err) {
          console.error('❌ Follow-up failed:', err.message);
        }
      } else {
        try {
          await interaction.followUp({
            content: `❌ Verification failed: ${message}\nEnsure:
- Hash is correct (64 hex characters)
- Transaction involves \`${wallet}\`
- Transaction is confirmed on Cardano mainnet
Wait 60 seconds and retry with \`/hash\`, or restart with \`/verify\`.`,
            flags: 64 // Ephemeral flag
          });
        } catch (err) {
          console.error('❌ Follow-up failed:', err.message);
        }
      }
    } catch (err) {
      console.error('❌ Hash verification error:', err.message, err.stack);
      try {
        await interaction.followUp({
          content: '❌ An error occurred during verification. Try again.',
          flags: 64 // Ephemeral flag
        });
      } catch (replyErr) {
        console.error('❌ Failed to send error reply:', replyErr.message);
      }
    }
  }
});

// Login to Discord
client.login(DISCORD_BOT_TOKEN).catch(err => {
  console.error('❌ Login failed:', err.message, err.stack);
  process.exit(1);
});
