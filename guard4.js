const mineflayer = require('mineflayer');
const pvp = require('mineflayer-pvp').plugin;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock, GoalNear, GoalNearB } = require('mineflayer-pathfinder').goals;

const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  username: process.argv[4] ? process.argv[4] : 'ArcherGuardBot',
  version: false
});

bot.loadPlugin(pvp);
bot.loadPlugin(pathfinder);

let guardPos = null;
let isAttacking = false;

// --- デバッグ用ログ ---
bot.on('entitySpawn', (entity) => {
    if (entity.type === 'mob' || entity.type === 'hostile' || entity.type === 'player') {
        // 修正箇所: entity.position.toFixed を entity.position.x.toFixed などに修正
        console.log(`[DEBUG] Spawned Entity: ID: ${entity.id}, Type: ${entity.type}, Name: ${entity.displayName || entity.username}, Position: (${entity.position.x.toFixed(2)}, ${entity.position.y.toFixed(2)}, ${entity.position.z.toFixed(2)})`);
    }
});

bot.on('entityGone', (entity) => {
    // Mobが消えた時のデバッグログ。必要に応じてコメントを外してください。
    // console.log(`[DEBUG] Entity Gone: ID: ${entity.id}, Type: ${entity.type}, Name: ${entity.displayName || (entity.username || 'unknown')}`);
});
// --- デバッグ用ログここまで ---

// --- イベントリスナー ---

bot.on('spawn', async () => {
  bot.chat('Archer guard bot has spawned!');

  await bot.waitForTicks(40); // 約2秒待つ

  // /give コマンドで弓と矢、そしてダイヤモンド防具を付与
  bot.chat('/give @s bow 1');
  bot.chat('/give @s arrow 64');
  bot.chat('/give @s diamond_helmet 1');
  bot.chat('/give @s diamond_chestplate 1');
  bot.chat('/give @s diamond_leggings 1');
  bot.chat('/give @s diamond_boots 1');
  bot.chat('I have received my bow, arrows, and diamond gear!');

  await bot.waitForTicks(20); // アイテムが付与されてインベントリに入るまで少し待つ

  async function equipItem(itemName, destination) {
    // bot.registry.itemsByName[itemName] が undefined の可能性があるので ?. を使う
    const item = bot.inventory.findInventoryItem(bot.registry.itemsByName[itemName]?.id);
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

  await equipItem('bow', 'hand');
  await equipItem('diamond_helmet', 'head');
  await equipItem('diamond_chestplate', 'torso');
  await equipItem('diamond_leggings', 'legs');
  await equipItem('diamond_boots', 'feet');

  bot.chat('My diamond gear is now equipped!');
});

bot.on('chat', (username, message) => {
  console.log(`[DEBUG] Chat received - From: ${username}, Message: "${message}"`); // 受信したチャットメッセージをログ
  if (username === bot.username) {
    console.log('[DEBUG] Message is from self, ignoring.');
    return; // 自分のメッセージは無視
  }

  if (message === 'guard here') {
    console.log('[DEBUG] "guard here" command received.');
    // bot.entity.position が存在するかどうかを確認
    if (bot.entity && bot.entity.position) {
      guardPos = bot.entity.position.clone();
      console.log(`[DEBUG] guardPos set to: ${guardPos.x.toFixed(0)}, ${guardPos.y.toFixed(0)}, ${guardPos.z.toFixed(0)}`);
      bot.chat(`I will guard this position: ${guardPos.x.toFixed(0)}, ${guardPos.y.toFixed(0)}, ${guardPos.z.toFixed(0)}`);
    } else {
      console.error('[ERROR] Bot entity position is not available yet. Cannot set guard position.');
      bot.chat('My position is not ready yet. Please try again in a moment.');
    }
  } else if (message === 'stop guard') {
    console.log('[DEBUG] "stop guard" command received.');
    guardPos = null;
    if (isAttacking) {
        bot.deactivateItem();
        isAttacking = false;
    }
    bot.pvp.stop();
    bot.chat('Stopped guarding.');
  }
});

// イベント名を 'physicsTick' に修正 (すでに修正済みのはずですが、念のため)
bot.on('physicsTick', async () => {
  if (!guardPos) {
    if (isAttacking) {
        bot.deactivateItem();
        isAttacking = false;
    }
    if (bot.pvp.target) {
        bot.pvp.stop();
    }
    return;
  }

  // 弓が装備されているか確認 (bot.heldItem を使用)
  const equippedBow = bot.heldItem && bot.heldItem.name === 'bow';
  if (!equippedBow) {
      console.log('No bow equipped in hand. Cannot attack.');
      if (isAttacking) {
          bot.deactivateItem();
          isAttacking = false;
      }
      if (bot.pvp.target) {
          bot.pvp.stop();
      }
      return;
  }

  // 矢があるか確認
  const hasArrow = bot.inventory.findInventoryItem(bot.registry.itemsByName.arrow?.id);
  if (!hasArrow) {
      console.log('No arrows in inventory. Cannot attack with bow.');
      if (isAttacking) {
          bot.deactivateItem();
          isAttacking = false;
      }
      if (bot.pvp.target) {
          bot.pvp.stop();
      }
      return;
  }

  // ターゲットフィルター
  const filter = e =>
    (e.type === 'mob' || e.type === 'hostile') &&
    e.position.distanceTo(bot.entity.position) < 30 &&
    e.displayName !== 'Armor Stand' &&
    e.displayName !== 'Iron Golem';

  const entity = bot.nearestEntity(filter);

  if (entity) {
    console.log(`Targeting: ${entity.displayName} (Type: ${entity.type}, Distance: ${entity.position.distanceTo(bot.entity.position).toFixed(2)})`);

    bot.pvp.target = entity;

    // ターゲットの方向を向く
    bot.lookAt(entity.position.offset(0, entity.height, 0));

    const distanceToTarget = bot.entity.position.distanceTo(entity.position);
    const minBowDistance = 8;
    const maxBowDistance = 25;

    if (distanceToTarget > minBowDistance && distanceToTarget < maxBowDistance && !isAttacking) {
        bot.activateItem();
        isAttacking = true;
        console.log('Starting to draw bow.');
    } else if (distanceToTarget <= minBowDistance && isAttacking) {
        bot.deactivateItem();
        isAttacking = false;
        console.log('Target too close, deactivating bow.');
    } else if (isAttacking && distanceToTarget > maxBowDistance) {
        bot.deactivateItem();
        isAttacking = false;
        console.log('Target too far, deactivating bow.');
    }

  } else {
    if (isAttacking) {
      bot.deactivateItem();
      isAttacking = false;
      console.log('No valid target found. Deactivating bow.');
    }
    if (bot.pvp.target) {
      bot.pvp.stop();
      console.log('No valid target found in range. Stopping attack via pvp plugin.');
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