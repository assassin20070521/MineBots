const mineflayer = require('mineflayer');
const pvp = require('mineflayer-pvp').plugin;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock, GoalNear, GoalNearB } = require('mineflayer-pathfinder').goals;

const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  username: process.argv[4] ? process.argv[4] : 'GuardBot',
  version: false
});

bot.loadPlugin(pvp);
bot.loadPlugin(pathfinder);

let guardPos = null;

// --- イベントリスナー ---

// ボットがスポーンした時
bot.on('spawn', async () => { // async を追加して await が使えるようにする
  bot.chat('Guard bot has spawned!');

  // スポーン後、少し待ってから装備を付与
  await bot.waitForTicks(40); // 約2秒 (20 tick/秒 * 2秒 = 40 tick)

  // /give コマンドでアイテムを付与
  bot.chat('/give @s diamond_sword 1');
  bot.chat('/give @s diamond_helmet 1');
  bot.chat('/give @s diamond_chestplate 1');
  bot.chat('/give @s diamond_leggings 1');
  bot.chat('/give @s diamond_boots 1');
  bot.chat('I have received my diamond gear!');

  // アイテムが付与されてインベントリに入るまで少し待つ
  await bot.waitForTicks(20); // 約1秒待つ

  // インベントリからアイテムを探して装備する関数
  async function equipItem(itemName, destination) {
    const item = bot.inventory.findInventoryItem(bot.registry.itemsByName[itemName].id);
    if (item) {
      try {
        await bot.equip(item, destination);
        console.log(`${itemName} equipped successfully as ${destination}.`);
      } catch (err) {
        console.error(`Failed to equip ${itemName} as ${destination}: ${err.message}`);
      }
    } else {
      console.log(`${itemName} not found in inventory.`);
    }
  }

  // 各アイテムを装備
  await equipItem('diamond_sword', 'hand');
  await equipItem('diamond_helmet', 'head');
  await equipItem('diamond_chestplate', 'torso');
  await equipItem('diamond_leggings', 'legs');
  await equipItem('diamond_boots', 'feet');

  bot.chat('My diamond gear is now equipped!');

  // ここで初期のガード位置を設定することもできます。
  // 例: guardPos = bot.entity.position.clone();
  // bot.chat(`Now guarding at ${guardPos.x.toFixed(0)}, ${guardPos.y.toFixed(0)}, ${guardPos.z.toFixed(0)}`);
});

// 以降のコードは変更なし
bot.on('chat', (username, message) => {
  if (username === bot.username) return;

  if (message === 'guard here') {
    guardPos = bot.entity.position.clone();
    bot.chat(`I will guard this position: ${guardPos.x.toFixed(0)}, ${guardPos.y.toFixed(0)}, ${guardPos.z.toFixed(0)}`);
  } else if (message === 'stop guard') {
    guardPos = null;
    bot.pvp.stop();
    bot.chat('Stopped guarding.');
  }
});

bot.on('physicsTick', () => {
  if (!guardPos) {
    if (bot.pvp.target) {
        bot.pvp.stop();
        console.log('Guard position cleared. Stopping any active attack.');
    }
    return;
  }

  const filter = e =>
    (e.type === 'mob' || e.type === 'hostile') &&
    e.position.distanceTo(bot.entity.position) < 16 &&
    e.displayName !== 'Armor Stand' &&
    e.displayName !== 'Iron Golem';

  const entity = bot.nearestEntity(filter);

  if (entity) {
    console.log(`Targeting: ${entity.displayName} (Type: ${entity.type}, Distance: ${entity.position.distanceTo(bot.entity.position).toFixed(2)})`);
    bot.pvp.attack(entity);
  } else {
    if (bot.pvp.target) {
      console.log('No valid target found in range. Stopping attack.');
      bot.pvp.stop();
    }
  }
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
});

bot.on('kicked', (reason) => {
  console.log(`Bot kicked: ${reason}`);
});

bot.on('end', () => {
  console.log('Bot disconnected.');
});