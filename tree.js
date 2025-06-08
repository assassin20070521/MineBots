const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;

const botConfig = {
  host: 'localhost',      // MinecraftサーバーのIPアドレス
  port: 25565,            // ポート（通常は25565）
  username: 'WoodCutter', // ボットの名前
  version: '1.20.5'       // 使用中のMinecraftバージョン
};

const bot = mineflayer.createBot(botConfig);

// プラグインのロード
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);

let mcData = null;
let isChopping = false;

bot.once('spawn', () => {
  mcData = require('minecraft-data')(bot.version);
  console.log('[STATUS] Minecraft data loaded successfully!');

  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  bot.chat('Hello! Type "chop" to start chopping trees.');
  console.log('[STATUS] Bot is ready and waiting for "chop" command.');
});

bot.on('login', () => {
  console.log(`[STATUS] ${bot.username} がログインしました！`);
});

bot.on('chat', async (username, message) => {
  if (username === bot.username) return;

  const msg = message.toLowerCase();

  if (msg === 'chop') {
    if (!mcData) {
      bot.chat("Minecraft data is not ready yet.");
      console.log('[COMMAND] "chop" command ignored: mcData not loaded.');
      return;
    }
    if (isChopping) {
      bot.chat("I'm already chopping trees!");
    } else {
      bot.chat("Starting to chop trees...");
      console.log('[COMMAND] Starting chopping activity.');
      startChoppingTrees();
    }
  } else if (msg === 'stop chop') {
    if (isChopping) {
      bot.chat("Stopping chopping activity.");
      console.log('[COMMAND] Stopping chopping activity.');
      isChopping = false;
      bot.pathfinder.stop();
      bot.collectBlock.stop();
    } else {
      bot.chat("I'm not chopping trees right now.");
    }
  }
});

async function startChoppingTrees() {
  if (isChopping) return;
  isChopping = true;
  console.log('[TASK] Chopping started.');

  while (isChopping) {
    if (!mcData) {
      console.error("[ERROR] mcData is missing during chopping.");
      bot.chat("Critical error: Minecraft data missing. Stopping.");
      isChopping = false;
      break;
    }

    const emptySlots = bot.inventory.emptySlotCount();
    if (emptySlots < 5) {
      bot.chat("Inventory almost full! Please empty it.");
      console.log(`[WARNING] Inventory nearly full (${emptySlots} empty slots).`);
      isChopping = false;
      break;
    }

    const treeTrunkIds = [
      mcData.blocksByName.oak_log.id,
      mcData.blocksByName.spruce_log.id,
      mcData.blocksByName.birch_log.id,
      mcData.blocksByName.jungle_log.id,
      mcData.blocksByName.acacia_log.id,
      mcData.blocksByName.dark_oak_log.id
    ];

    console.log('[TASK] Searching for nearby trees...');
    const targetBlock = bot.findBlock({
      matching: treeTrunkIds,
      maxDistance: 64,
      count: 1
    });

    if (targetBlock) {
      console.log(`[TASK] Tree found at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z}).`);
      bot.chat(`Found a tree! Chopping...`);
      try {
        await bot.collectBlock.collect(targetBlock);
        console.log('[TASK] Tree chopped successfully.');
      } catch (err) {
        if (err.message === 'No block found') {
          console.log('[INFO] Tree already gone or unreachable.');
        } else {
          console.error(`[ERROR] Chopping error: ${err.message}`);
          bot.chat(`Error chopping tree: ${err.message}`);
          isChopping = false;
          break;
        }
      }
    } else {
      bot.chat("No trees nearby. Going idle.");
      console.log('[TASK] No trees found. Stopping.');
      isChopping = false;
      break;
    }

    await bot.waitForTicks(20); // 1秒待つ
  }

  isChopping = false;
  console.log('[TASK] Chopping activity ended.');
  bot.chat("Chopping activity finished.");
}

// エラーハンドリング
bot.on('kicked', (reason, loggedIn) => console.log(`[CONNECTION] Kicked: ${reason}`));
bot.on('error', err => console.error(`[ERROR] ${err.message}`));
bot.on('end', () => {
  console.log('[CONNECTION] Bot disconnected.');
  isChopping = false;
});
