const mineflayer = require('mineflayer')
const vec3 = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const GoalBlock = goals.GoalBlock
const GoalNear = goals.GoalNear

// ボットの接続情報
const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: process.env.BOT_USERNAME || 'AutoMinerDefault', // 環境変数から取得、なければデフォルト名
  // password: 'your_password', // パスワードが必要な場合はコメントを外して設定
  version: '1.20.5'
})

let isMining = false
let defaultMove;
let initialSpawnPoint = null; // 初期スポーン地点を記憶する変数
let stoneAxeId = null; // 石斧のIDを保存

// Pathfinderプラグインをロード
bot.loadPlugin(pathfinder)

// --- イベントリスナー ---

bot.on('spawn', async () => {
  console.log('ボットがスポーンしました！自動掘削を開始します...');
  
  // 初期スポーン地点を記憶
  if (!initialSpawnPoint) {
    initialSpawnPoint = bot.entity.position.clone();
    console.log(`初期スポーン地点を記憶しました: ${initialSpawnPoint.toString()}`);
  }

  // Pathfinderの移動設定を初期化
  defaultMove = new Movements(bot, bot.registry);
  defaultMove.canDig = true; // ブロックを掘って進むことを許可

  // 石斧のIDを特定
  // bot.registry.itemsByName から直接アクセス
  const stoneAxeItem = bot.registry.itemsByName.stone_axe;
  if (stoneAxeItem) {
    stoneAxeId = stoneAxeItem.id;
    console.log(`石斧のIDを特定しました: ${stoneAxeId}`);
  } else {
    console.warn('石斧のアイテムIDが見つかりません。バージョンを確認してください。');
  }

  // ツールを装備する
  await equipToolForDigging();

  if (!isMining) {
    startAutoMining();
  }
});

bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  console.log(`${username}: ${message}`);

  switch (message) {
    case 'loaded':
      await bot.waitForChunksToLoad()
      bot.chat('Ready!')
      break
    case 'list':
      sayItems()
      break
    case 'start mining':
      if (!isMining) {
        startAutoMining();
        bot.chat('自動掘削を開始します。');
      } else {
        bot.chat('すでに掘削中です。');
      }
      break;
    case 'stop mining':
      if (isMining) {
        isMining = false;
        bot.chat('自動掘削を停止します。');
      } else {
        bot.chat('現在掘削していません。');
      }
      break;
    case 'dig':
      digSingleBlockBelow();
      break;
    case 'build':
      build()
      break
    case 'equip dirt':
      equipDirt()
      break
    case 'return to base': // 手動で拠点に戻るコマンド
      await returnToBaseAndDepositItems();
      break;
  }
})

bot.on('kicked', (reason) => console.log('キックされました:', reason));
bot.on('error', (err) => console.log('エラーが発生しました:', err));
bot.on('end', () => {
  console.log('接続が終了しました。');
  isMining = false;
});

// 手持ちのアイテム（装備スロット）が変更された時に呼ばれるイベント
bot.on('equipmentSlotChanged', async (slot, oldItem, newItem) => {
    // 手持ちスロット (0番) の変更を監視
    // oldItem があり、そのアイテムのIDが石斧のIDと一致し、
    // かつ newItem が null (つまりスロットが空になった) の場合
    if (slot === 0 && oldItem && oldItem.type === stoneAxeId && !newItem) {
        console.warn('石斧が壊れました！初期位置に戻り、アイテムをチェストに入れます。');
        isMining = false; // 掘削を停止
        bot.chat('石斧が壊れたため、初期位置に戻ります。');
        await returnToBaseAndDepositItems();
    }
});


// --- ヘルパー関数 (元のコードから) ---

function sayItems (items = bot.inventory.items()) {
  const output = items.map(itemToString).join(', ')
  if (output) {
    bot.chat(output)
  } else {
    bot.chat('empty')
  }
}

function build () {
  const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0))
  const jumpY = Math.floor(bot.entity.position.y) + 1.0
  bot.setControlState('jump', true)
  bot.on('move', placeIfHighEnough)

  let tryCount = 0

  async function placeIfHighEnough () {
    if (bot.entity.position.y > jumpY) {
      try {
        await bot.placeBlock(referenceBlock, vec3(0, 1, 0))
        bot.setControlState('jump', false)
        bot.removeListener('move', placeIfHighEnough)
        bot.chat('Placing a block was successful')
      } catch (err) {
        tryCount++
        if (tryCount > 10) {
          bot.chat(err.message)
          bot.setControlState('jump', false)
          bot.removeListener('move', placeIfHighEnough)
        }
      }
    }
  }
}

async function equipDirt () {
  let itemsByName
  if (bot.supportFeature('itemsAreNotBlocks')) {
    itemsByName = 'itemsByName'
  } else if (bot.supportFeature('itemsAreAlsoBlocks')) {
    itemsByName = 'blocksByName'
  }
  try {
    await bot.equip(bot.registry[itemsByName].dirt.id, 'hand')
    bot.chat('equipped dirt')
  } catch (err) {
    bot.chat(`unable to equip dirt: ${err.message}`)
  }
}

function itemToString (item) {
  if (item) {
    return `${item.name} x ${item.count}`
  } else {
    return '(nothing)'
  }
}

// --- 新規追加・修正された掘削＆ツール破損ロジック ---

// 真下のブロックを1つ掘る関数
async function digSingleBlockBelow () {
  let target
  if (bot.targetDigBlock) {
    bot.chat(`すでに ${bot.targetDigBlock.name} を掘削中です`)
    return false
  } else {
    target = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    
    if (!target || bot.canDigBlock(target) === false || target.type === 0) { 
      console.log(`真下のブロックを掘れません: ${target ? target.displayName : 'ブロックなし'}`);
      return false
    }

    bot.chat(`真下の ${target.displayName} を掘り始めます`)
    try {
      await bot.dig(target)
      bot.chat(`真下の ${target.displayName} を掘り終えました`)
      return true
    } catch (err) {
      console.log(`掘削中にエラーが発生しました: ${err.stack}`)
      bot.chat(`掘削中にエラーが発生しました: ${err.message}`)
      return false
    }
  }
}

// 自動掘削のメインロジック
async function startAutoMining() {
    isMining = true;
    console.log('自動掘削ループを開始します。');

    while (isMining) {
        try {
            const currentBotPosition = bot.entity.position.clone();

            console.log('真下のブロックを掘ります...');
            const success = await digSingleBlockBelow();
            if (!success) {
                console.log('真下のブロックを掘れませんでした。自動掘削を停止します。');
                bot.chat('真下のブロックが掘れませんでした。自動掘削を停止します。');
                isMining = false;
                break;
            }
            await bot.waitForTicks(5);

            const newFloorPosition = currentBotPosition.offset(0, -1, 0);
            console.log(`掘った穴の底へ移動します: ${newFloorPosition.toString()}`);
            bot.pathfinder.setMovements(defaultMove);
            try {
                await bot.pathfinder.goto(new GoalBlock(newFloorPosition.x, newFloorPosition.y, newFloorPosition.z));
                console.log('新しい階層に移動しました。');
                await bot.waitForTicks(10);
            } catch (moveErr) {
                console.warn(`新しい階層への移動に失敗しました: ${moveErr.message}`);
            }

            const currentFloorCenterAfterMove = bot.entity.position.clone();
            console.log(`周囲16ブロックを水平に掘ります。基準点: ${currentFloorCenterAfterMove.toString()}`);
            const blocksToMineAround = [];

            const radius = 2; // 中心からの最大距離 (5x5範囲)
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    if (x === 0 && z === 0) continue; 
                    
                    const blockPos = currentFloorCenterAfterMove.offset(x, 0, z);
                    const block = bot.blockAt(blockPos);

                    if (block && bot.canDigBlock(block) && block.type !== 0 && block.material !== 'water' && block.material !== 'lava') {
                        blocksToMineAround.push(block);
                    }
                }
            }

            blocksToMineAround.sort((a, b) => {
                const distA = a.position.distanceTo(currentFloorCenterAfterMove);
                const distB = b.position.distanceTo(currentFloorCenterAfterMove);
                return distA - distB;
            });

            const finalBlocksToMine = blocksToMineAround.slice(0, 16);
            let minedCount = 0;

            for (const block of finalBlocksToMine) {
                if (!isMining) break;

                try {
                    await bot.pathfinder.goto(new GoalBlock(block.position.x, block.position.y, block.position.z));
                    
                    await bot.dig(block);
                    minedCount++;
                    await bot.waitForTicks(2);
                } catch (err) {
                    console.warn(`ブロック ${block.displayName} (${block.position.toString()}) を掘れませんでした: ${err.message}`);
                }
            }
            console.log(`周囲のブロックを掘り終えました。掘った数: ${minedCount}/${finalBlocksToMine.length}`);

            await bot.waitForTicks(20);

        } catch (err) {
            console.error('自動掘削中に予期せぬエラーが発生しました:', err);
            isMining = false;
            bot.chat(`予期せぬエラーが発生したため掘削を停止しました: ${err.message}`);
            break;
        }

        if (!isMining) {
            console.log('自動掘削ループを終了します。');
            break;
        }
    }
}

// ツールを装備するヘルパー関数
async function equipToolForDigging() {
    const shovel = bot.inventory.items().find(item => item.name.includes('shovel'));
    const pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
    const axe = bot.inventory.items().find(item => item.name.includes('axe'));

    if (axe) {
        await bot.equip(axe, 'hand');
        console.log('斧を装備しました。');
    } else if (shovel) {
        await bot.equip(shovel, 'hand');
        console.log('シャベルを装備しました。');
    } else if (pickaxe) {
        await bot.equip(pickaxe, 'hand');
        console.log('ツルハシを装備しました。');
    } else {
        console.warn('掘削できるツールが見つかりません！手掘りになります。');
        bot.chat('掘削できるツールがありません！');
    }
    await bot.waitForTicks(5);
}

// 初期位置に戻ってチェストにアイテムを預ける関数
async function returnToBaseAndDepositItems() {
    if (!initialSpawnPoint) {
        bot.chat('初期スポーン地点が設定されていません。');
        return;
    }

    bot.chat('初期位置に戻ります...');
    isMining = false; // 掘削を停止

    // 初期スポーン地点の近くに移動
    bot.pathfinder.setMovements(defaultMove);
    try {
        // GoalNear は指定した座標の範囲内 (2ブロック以内) に移動する
        await bot.pathfinder.goto(new GoalNear(initialSpawnPoint.x, initialSpawnPoint.y, initialSpawnPoint.z, 2)); 
        bot.chat('初期位置に戻りました。');
    } catch (err) {
        console.error(`初期位置への移動に失敗しました: ${err.message}`);
        bot.chat('初期位置への移動に失敗しました。');
        return;
    }

    // 周囲のチェストを探す
    // bot.registry.blocksByName.chest.id でチェストのIDを取得
    const chestBlock = bot.findBlock({
        matching: bot.registry.blocksByName.chest.id,
        maxDistance: 8 // ボットから8ブロック以内
    });

    if (chestBlock) {
        bot.chat('チェストを見つけました。アイテムを預けます。');
        try {
            const chest = await bot.openContainer(chestBlock);
            
            // 全てのアイテムをチェストに入れる (装備中のアイテムは除く)
            for (const item of bot.inventory.items()) {
                // slot 0 は現在装備中のアイテムのスロット
                // 装備中のアイテムはそのままにして、それ以外のアイテムを預ける
                if (item.slot !== 0) { 
                    console.log(`チェストに ${item.name} x ${item.count} を預けます。`);
                    await chest.deposit(item.type, null, item.count); // null は metadata, count は数量
                    await bot.waitForTicks(5); // アイテムを預ける間の待機
                }
            }
            await chest.close();
            bot.chat('すべてのアイテムをチェストに入れました。');
        } catch (err) {
            console.error(`チェスト操作中にエラーが発生しました: ${err.message}`);
            bot.chat(`チェスト操作中にエラーが発生しました: ${err.message}`);
        }
    } else {
        bot.chat('近くにチェストが見つかりません。');
    }

    // アイテム預け入れまでで完了とし、自動掘削は再開しない（手動でstart mining）
    bot.chat('準備ができました。`start mining`で再開できます。');
}