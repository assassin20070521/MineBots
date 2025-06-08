const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

let mcData // グローバルスコープでmcDataを宣言

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'TorchBot'
})

bot.loadPlugin(pathfinder)

bot.once('spawn', async () => {
  mcData = require('minecraft-data')(bot.version)
  const defaultMove = new Movements(bot, mcData)
  bot.pathfinder.setMovements(defaultMove)

  bot.chat('松明設置BOT、起動しました！')

  let currentDirection = new Vec3(1, 0, 0) // 最初はX軸プラス方向 (東) に進むと仮定

  while (true) {
    try {
      const torch = bot.inventory.items().find(i => i.name === 'torch')
      if (!torch) {
        bot.chat('松明がありません。松明をください！')
        await bot.waitForTicks(200)
        continue
      }

      const targetPos = bot.entity.position.plus(currentDirection.scaled(5)).floor()
      const groundBlock = bot.blockAt(targetPos.offset(0, -1, 0)) // ターゲット位置の1ブロック下
      const blockAtTarget = bot.blockAt(targetPos); // ターゲット位置のブロック

      // 松明を置く条件をよりシンプルに判断します
      // 1. groundBlockが存在し、空気ブロックではないこと (足場があること)
      // 2. blockAtTargetが存在し、空気ブロックであること (松明を置く空間があること)
      // 3. (オプション) 溶岩や水などの上に置かないようにする追加チェック
      const isGroundSolid = groundBlock && groundBlock.boundingBox === 'block' && groundBlock.type !== mcData.blocksByName.air.id;
      const isTargetAir = blockAtTarget && blockAtTarget.type === mcData.blocksByName.air.id;

      // 松明を置く適切な場所かどうかの基本的な判断
      // isTargetAir: ターゲット位置が空気か
      // isGroundSolid: ターゲット位置の1ブロック下が固体ブロックか (松明を置く足場)
      if (isGroundSolid && isTargetAir) {
        bot.chat(`移動して松明を設置: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`)

        // 松明を置く位置に近づく (精度を下げて移動時間を短縮)
        await bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2))

        await bot.equip(torch, 'hand')
        // 松明を置く (groundBlockの上に置く)
        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0))
        bot.chat(`松明を設置しました: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`)

        await bot.waitForTicks(20) // 1秒待機
      } else {
        bot.chat('松明を置ける場所が見つかりませんでした。方向転換します。')
        // 簡単な方向転換ロジック (例: 90度回転)
        if (currentDirection.x === 1) currentDirection = new Vec3(0, 0, 1) // 東 -> 南
        else if (currentDirection.z === 1) currentDirection = new Vec3(-1, 0, 0) // 南 -> 西
        else if (currentDirection.x === -1) currentDirection = new Vec3(0, 0, -1) // 西 -> 北
        else if (currentDirection.z === -1) currentDirection = new Vec3(1, 0, 0) // 北 -> 東
        await bot.waitForTicks(40) // 方向転換後、少し待機
      }

    } catch (e) {
      bot.chat('エラー: ' + e.message)
      await bot.waitForTicks(100)
    }

    await bot.waitForTicks(20)
  }
})