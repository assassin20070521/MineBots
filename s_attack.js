/*
 * このボットは、メッセージを送ったプレイヤー、または（プレイヤーを除く）最も近いエンティティを攻撃します。
 * また、特定の名前のエンティティ、あるいは指定されたターゲットまで移動して攻撃することもできます。
 * さらに、アイドル時に特定のエンティティ（例: 羊）を自動的に探し、狩り続ける自律機能も持ちます。
 * ターゲットの追跡と攻撃は、状態管理とループによってより堅牢に行われます。
 */
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3') // 座標計算のためにVec3をインポート

if (process.argv.length < 4 || process.argv.length > 6) {
  console.log('使い方 : node auto_hunt_bot.js <ホスト> <ポート> [<プレイヤー名>] [<パスワード>]')
  process.exit(1)
}

const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  username: process.argv[4] ? process.argv[4] : 'hunter',
  password: process.argv[5]
})

// === ボットの状態管理フラグ ===
bot.isHunting = false // 自律狩りモードが有効かどうか
bot.currentHuntTargetEntity = null // 現在追跡・攻撃中のエンティティオブジェクト
bot.currentHuntTargetName = null // 現在追跡中のエンティティの名前 (例: 'sheep')
bot._huntMainLoopInterval = null // メインの狩りループの setInterval ID
bot._attackInterval = null // ターゲットへの継続攻撃の setInterval ID
bot._isMovingToTarget = false // 現在ターゲットへ移動中かどうか

// === ボットがワールドにスポーンしたときの初期設定 ===
bot.on('spawn', () => {
  bot.loadPlugin(pathfinder) // pathfinderプラグインをボットにロードします。

  // デフォルトの移動設定を初期化
  const defaultMove = new Movements(bot)
  bot.pathfinder.setMovements(defaultMove)

  // チャットコマンドのリスナー
  bot.on('chat', (username, message) => {
    const args = message.split(' ')

    if (args[0] === 'attack') {
      if (args.length === 1) {
        stopHunting() // 自律狩り中なら停止
        attackNearestEntity()
      } else if (args[1] === 'me') {
        stopHunting() // 自律狩り中なら停止
        attackPlayer(username)
      } else if (args[1] === 'goto') {
        if (args.length > 2) {
          stopHunting() // 自律狩り中なら停止
          attackAndMoveToTargetManual(args[2]) // 手動移動攻撃は別の関数に分離
        } else {
          bot.chat('使い方: attack goto <エンティティ名またはプレイヤー名>')
        }
      } else {
        stopHunting() // 自律狩り中なら停止
        attackSpecificEntity(args[1])
      }
    } else if (message.startsWith('start hunt')) {
      if (args.length > 1) {
        startHunting(args[2]) // 例: "start hunt sheep"
      } else {
        bot.chat('使い方: start hunt <エンティティ名>')
      }
    } else if (message === 'stop hunt') {
      stopHunting()
    } else if (message === 'stop all') { // すべての行動を停止する新しいコマンド
      stopHunting() // 狩りモード停止
      stopAllActions() // 個別アクションも停止
      bot.chat('全ての行動を停止しました。')
    }
  })
})

// === 汎用アクション停止関数 ===
function stopAllActions() {
  if (bot._attackInterval) {
    clearInterval(bot._attackInterval)
    bot._attackInterval = null
  }
  if (bot.pathfinder && bot._isMovingToTarget) { // 移動中であればパスファインダーを停止
    bot.pathfinder.stop()
    bot._isMovingToTarget = false
  }
  bot.setControlState('forward', false)
  bot.clearControlStates()
  bot.currentHuntTargetEntity = null // ターゲットをリセット
  bot.target = null // mineflayerの内部ターゲットもリセット
}

// === 自律狩り機能のコアロジック ===

// 自律狩りモードを開始する関数
function startHunting(entityNameToHunt) {
  if (bot.isHunting) {
    bot.chat(`既に ${bot.currentHuntTargetName} の狩りを継続中だよ。`)
    return
  }
  bot.isHunting = true
  bot.currentHuntTargetName = entityNameToHunt
  bot.chat(`${entityNameToHunt} の自律狩りを開始するよ！`)

  // メインの狩りループを起動
  bot._huntMainLoopInterval = setInterval(huntMainLoop, 3000) // 3秒ごとにメインループを実行
  huntMainLoop() // 初回はすぐに実行
}

// 自律狩りモードを停止する関数
function stopHunting() {
  if (bot._huntMainLoopInterval) {
    clearInterval(bot._huntMainLoopInterval)
    bot._huntMainLoopInterval = null
  }
  bot.isHunting = false
  bot.chat('自律狩りを停止したよ。')
  stopAllActions() // 停止時に全ての行動をリセット
}

// メインの狩りループ
async function huntMainLoop() {
  if (!bot.isHunting) return // 狩りモードでなければ何もしない

  // 1. ターゲットが既にいる、かつ移動中であれば何もしない
  if (bot.currentHuntTargetEntity && bot._isMovingToTarget) {
    // bot.chat(`[Debug] ${bot.currentHuntTargetEntity.name} へ移動中...`)
    return
  }

  // 2. ターゲットがいない、または見失った場合、新しいターゲットを探す
  if (!bot.currentHuntTargetEntity || !bot.currentHuntTargetEntity.isValid || bot.entity.position.distanceTo(bot.currentHuntTargetEntity.position) > 256) {
    stopAllActions() // 古いターゲットの痕跡をクリア
    bot.chat(`[Hunter] 新しい ${bot.currentHuntTargetName} を探すよ...`)
    const newTarget = bot.nearestEntity((e) => e.type !== 'player' && e.name === bot.currentHuntTargetName, 128) // 128ブロック範囲で検索

    if (newTarget) {
      bot.currentHuntTargetEntity = newTarget
      bot.chat(`[Hunter] ${newTarget.name} を見つけたよ！`)
      await moveToAndAttackTarget(newTarget) // 見つけたら移動して攻撃
    } else {
      bot.chat(`[Hunter] ${bot.currentHuntTargetName} は見つからないな...`)
    }
  } else {
    // 3. ターゲットが有効で近くにいるが、まだ攻撃を開始していない場合
    if (!bot._attackInterval) { // 攻撃ループが動いていない場合
      bot.chat(`[Hunter] ${bot.currentHuntTargetEntity.name} を再追跡/攻撃開始！`)
      await moveToAndAttackTarget(bot.currentHuntTargetEntity)
    }
  }
}

// === ターゲットへ移動し、到達後に攻撃を開始する関数 ===
async function moveToAndAttackTarget(targetEntity) {
  if (!targetEntity || !targetEntity.isValid) {
    bot.chat('ターゲットが無効だよ。')
    return
  }

  // 既に移動中であれば何もしない
  if (bot._isMovingToTarget) {
      return;
  }
  
  bot._isMovingToTarget = true // 移動フラグをセット
  bot.target = targetEntity // Mineflayerの内部ターゲットも設定

  const goal = new goals.GoalFollow(targetEntity, 1) // ターゲットを1ブロックの距離で追跡するゴール

  bot.chat(`[Path] ${targetEntity.name} のところへ移動中...`)

  try {
    await bot.pathfinder.goto(goal) // 目標に到達するまで待機
    
    bot._isMovingToTarget = false // 移動完了
    if (targetEntity.isValid) {
      bot.chat(`[Path] 目標に到達！${targetEntity.name} を攻撃開始！`)
      startContinuousAttack(targetEntity) // 攻撃ループを開始
    } else {
      bot.chat('[Path] ターゲットが移動中に消滅したよ。')
      stopAllActions()
    }
  } catch (err) {
    bot._isMovingToTarget = false // 移動中断
    if (err.name === 'NoPath') {
      bot.chat(`[Path] ${targetEntity.name} への道が見つからないよ。`)
    } else if (err.name === 'GoalBreak') {
        // GoalFollowがターゲットの移動によって目標をリフレッシュした場合は、エラーとして扱わない
        // ここでは単にawaitが中断されたとみなし、メインループに処理を任せる
        bot.chat(`[Path] ${targetEntity.name} の追跡が中断されたよ。(移動中)`)
    } else {
      bot.chat(`[Path] 移動中にエラーが発生したよ: ${err.message}`)
    }
    bot.currentHuntTargetEntity = null // ターゲットを見失ったと判断し、リセット
    stopAllActions() // 全ての行動を停止し、メインループで再探索を促す
  }
}

// === ターゲットに対する継続的な攻撃ループ ===
function startContinuousAttack(targetEntity) {
  if (!targetEntity || !targetEntity.isValid) {
    stopAllActions()
    return
  }

  // 既存の攻撃ループがあればクリア
  if (bot._attackInterval) {
    clearInterval(bot._attackInterval)
  }

  bot._attackInterval = setInterval(() => {
    // ターゲットが無効になったか、攻撃範囲外に出たら停止
    if (!targetEntity.isValid || bot.entity.position.distanceTo(targetEntity.position) > bot.attackRange + 0.5) {
      clearInterval(bot._attackInterval)
      bot._attackInterval = null
      bot.chat('[Attack] ターゲットが攻撃範囲外に出たか、消滅したよ。')
      
      // 自律狩りモードであれば、次のターゲットを探す
      if (bot.isHunting) {
        bot.currentHuntTargetEntity = null // ターゲットを見失ったのでリセット
        // huntMainLoopが次のターゲットを探す
      } else {
        stopAllActions() // 自律狩りモードでなければ、単発攻撃なので停止
      }
    } else {
      bot.attack(targetEntity) // 攻撃を継続
    }
  }, 500) // 0.5秒ごとに攻撃
}


// === 単発チャットコマンドからの攻撃関数（自律狩りモードとは独立） ===

// メモ: これらの関数は手動で `attack` コマンドが入力された時に呼び出されるため、
// 自律狩りモードを中断する役割も持たせています。
function attackPlayer (username) {
  stopHunting()
  const player = bot.players[username]
  if (!player || !player.entity) {
    bot.chat('見えないよ')
  } else {
    bot.chat(`${player.username} を攻撃中！`)
    bot.attack(player.entity)
  }
}

function attackNearestEntity () {
  stopHunting()
  const entity = bot.nearestEntity((entity) => entity.type !== 'player')
  if (!entity) {
    bot.chat('近くにエンティティがいないよ')
  } else {
    bot.chat(`${entity.name ?? '不明なエンティティ'} を攻撃中！`)
    bot.attack(entity)
  }
}

function attackSpecificEntity (entityName) {
  stopHunting()
  const entity = bot.nearestEntity((entity) => entity.name === entityName)
  if (!entity) {
    bot.chat(`${entityName} は近くにいないよ`)
  } else {
    bot.chat(`${entity.name} を攻撃中！`)
    bot.attack(entity)
  }
}

// 手動で特定のターゲットに移動して攻撃する関数
async function attackAndMoveToTargetManual (targetName) {
    stopHunting(); // 自律狩りモードを停止

    let targetEntity = bot.players[targetName]?.entity;
    if (!targetEntity) {
        targetEntity = bot.nearestEntity((entity) => entity.name === targetName);
    }

    if (!targetEntity) {
        bot.chat(`${targetName} というターゲットは見つからなかったよ。`);
        return;
    }

    // ここは自律狩りのループとは別の単発処理なので、
    // ターゲットが近くにいるならそのまま攻撃、遠ければ移動して攻撃する
    if (bot.entity.position.distanceTo(targetEntity.position) <= bot.attackRange + 0.5) {
        bot.chat(`${targetEntity.name} はもう目の前にいるよ！攻撃開始！`);
        startContinuousAttack(targetEntity);
        return;
    }

    bot.chat(`${targetEntity.name} のところへ移動して攻撃するよ！`);
    bot.target = targetEntity; // Mineflayerの内部ターゲットも設定

    const goal = new goals.GoalFollow(targetEntity, 1);
    
    let attackIntervalId; // この関数のためのローカル攻撃ループID

    attackIntervalId = setInterval(() => {
        if (!targetEntity.isValid || bot.entity.position.distanceTo(targetEntity.position) > 256) {
            clearInterval(attackIntervalId);
            stopAllActions();
            bot.chat(`${targetEntity.name} が遠すぎたか、消滅したよ。移動を中断するよ。`);
            return;
        }
        if (bot.entity.position.distanceTo(targetEntity.position) <= bot.attackRange + 0.5) {
            bot.attack(targetEntity);
        }
    }, 500);

    try {
        await bot.pathfinder.goto(goal);
        clearInterval(attackIntervalId);
        if (targetEntity.isValid) {
            bot.chat(`目標に到達！${targetEntity.name} を攻撃中！`);
            startContinuousAttack(targetEntity);
        } else {
            bot.chat('ターゲットが消滅したよ。');
            stopAllActions();
        }
    } catch (err) {
        clearInterval(attackIntervalId);
        if (err.name === 'NoPath') {
            bot.chat(`${targetEntity.name} への道が見つからないよ。`);
        } else {
            bot.chat(`移動中にエラーが発生したよ: ${err.message}`);
        }
        stopAllActions();
    }
}


// ボットでエラーが発生した場合、コンソールにログを出力します。
bot.on('error', console.log)

// ボットが切断された場合の処理
bot.on('end', (reason) => {
  console.log(`ボットが切断されました: ${reason}`)
  stopHunting() // 切断時に狩りを停止
  stopAllActions() // 全ての行動を停止
})

// デバッグ用: ボットのデバッグ情報を表示したい場合
// bot.on('debug', (message) => console.log(`[DEBUG] ${message}`))