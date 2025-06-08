// common_commands.js

const { Vec3 } = require('vec3'); // Vec3をインポート

module.exports = function (bot) {
    // 集合時の移動設定 (掘削や建築を許可しない、安全な移動)
    const assembleMovements = new bot.pathfinder.Movements(bot);
    assembleMovements.maxDropDown = 3; // 落下できる最大の高さ
    assembleMovements.allowSprinting = true; // スプリントを許可

    let currentAssembleTask = null; // 現在の集結タスクを管理
    let lastResumeTaskName = null; // スポーン後再開するタスクの名前 (例: 'hunt', 'mine')
    let lastResumeTargetName = null; // スポーン後再開するタスクのターゲット (例: 'sheep', null)

    // ボットのチャットイベントリスナー
    bot.on('chat', async (username, message) => {
        const args = message.split(' ');

        if (args[0] === 'come' && args[1] === 'here') {
            const player = bot.players[username];
            if (!player || !player.entity) {
                bot.chat(`[${bot.username}] ${username} が見えないよ。`);
                return;
            }
            bot.chat(`[${bot.username}] ${username} のところへ集結するよ！`);
            await assembleAtLocation(player.entity.position);

        } else if (args[0] === 'assemble') {
            if (args.length === 4 && !isNaN(args[1]) && !isNaN(args[2]) && !isNaN(args[3])) {
                const x = parseFloat(args[1]);
                const y = parseFloat(args[2]);
                const z = parseFloat(args[3]);
                const targetPos = new Vec3(x, y, z); // Vec3 を直接使用
                bot.chat(`[${bot.username}] 座標 ${x}, ${y}, ${z} に集結するよ！`);
                await assembleAtLocation(targetPos);
            } else {
                bot.chat(`[${bot.username}] 使い方: assemble <x> <y> <z> または come here`);
            }
        } else if (message === 'cancel assemble') {
            if (currentAssembleTask) {
                currentAssembleTask.cancel();
                currentAssembleTask = null;
                bot.chat(`[${bot.username}] 集結タスクをキャンセルしたよ。`);
            } else {
                bot.chat(`[${bot.username}] 現在、集結タスクは実行されていないよ。`);
            }
        } else if (message === 'deposit items') {
            await depositAllItemsInNearestChest();
        } else if (message.startsWith('return to spawn')) {
            // 現在のタスクを記憶して中断
            if (bot.isHunting) {
                lastResumeTaskName = 'hunt';
                lastResumeTargetName = bot.currentHuntTargetName;
            } else {
                lastResumeTaskName = null;
                lastResumeTargetName = null;
            }
            if (typeof bot.stopAllActions === 'function') {
                bot.stopAllActions();
                bot.chat(`[${bot.username}] 現在のタスクを中断してスポーン地点に戻るよ。`);
            }

            if (args[1] === 'die') { // "return to spawn die" で死亡して戻る
                bot.chat(`[${bot.username}] 死亡してスポーン地点に戻るよ...`);
                // 死亡してスポーン地点に戻る (アイテムロストのリスクあり)
                // PvPサーバーなどで利用する際は注意が必要
                bot.setControlState('forward', true);
                bot.setControlState('jump', true);
                bot.lookAt(bot.entity.position.offset(0, -100, 0)); // 下を見る
                bot.attack(bot.entity); // 自殺を試みる (場所によってはうまくいかない)
                setTimeout(() => {
                    if (bot.health > 0) { // まだ生きてたら高所から飛び降りるなどの工夫が必要
                        const safeY = bot.entity.position.y - 100;
                        bot.chat(`[${bot.username}] 自殺に失敗したかもしれない。高いところを探すよ。`);
                        bot.pathfinder.setMovements(assembleMovements);
                        bot.pathfinder.goto(new bot.pathfinder.goals.GoalBlock(bot.entity.position.x, safeY, bot.entity.position.z))
                            .catch(err => bot.chat(`[${bot.username}] 自殺場所が見つからない: ${err.message}`));
                    }
                }, 5000); // 5秒待ってまだ生きてたら
            } else { // "/spawn" コマンドを利用 (サーバー側で有効な場合)
                bot.chat(`[${bot.username}] /spawn コマンドでスポーン地点に戻るよ。`);
                bot.chat('/spawn'); // サーバーの /spawn コマンドを送信
            }
        }
    });

    // スポーンイベントリスナー (スポーン地点に戻った後にタスク再開)
    bot.on('spawn', () => {
        if (lastResumeTaskName === 'hunt' && lastResumeTargetName) {
            bot.chat(`[${bot.username}] スポーン地点に戻ったよ。${lastResumeTargetName} の狩りを再開するよ！`);
            // ここで、各ボットのstartHunting関数を呼び出す
            // bot.startHunting は common_commands.js からは直接アクセスできないので、
            // main bot file で bot.on('spawn') の後に commonCommands(bot); を呼び出し、
            // その後で bot.startHunting(lastResumeTargetName) を呼ぶロジックが必要になります。
            // あるいは、共通モジュールから呼び出せるよう、botにstartHuntingなどの関数を登録する
            if (typeof bot.startHunting === 'function') {
                bot.startHunting(lastResumeTargetName);
            } else {
                bot.chat(`[${bot.username}] startHunting 関数が見つからないよ。`);
            }
            lastResumeTaskName = null;
            lastResumeTargetName = null;
        } else {
            bot.chat(`[${bot.username}] スポーン地点に戻ったよ。`);
        }
    });


    /**
     * 指定された位置に集結する関数
     * @param {Vec3} targetPos 集結目標座標
     */
    async function assembleAtLocation(targetPos) {
        if (typeof bot.stopAllActions === 'function') {
            bot.stopAllActions();
            bot.chat(`[${bot.username}] 現在のタスクを中断して集結に向かうよ。`);
        } else {
            bot.isHunting = false; // 仮にisHuntingフラグがあるとしてリセット
            bot._isMovingToTarget = false;
            if (bot._huntMainLoopInterval) clearInterval(bot._huntMainLoopInterval);
            bot._huntMainLoopInterval = null;
            if (bot._attackInterval) clearInterval(bot._attackInterval);
            bot._attackInterval = null;
            if (bot._isCollectingItems && bot.collectBlock) bot.collectBlock.stop();
            bot._isCollectingItems = false;
            if (bot.pathfinder) bot.pathfinder.stop();
            bot.chat(`[${bot.username}] 現在のタスクを中断して集結に向かうよ。(手動フラグリセット)`);
        }

        if (!bot.pathfinder) {
            bot.chat(`[${bot.username}] パスファインダーがロードされていません。`);
            return;
        }
        
        bot.pathfinder.setMovements(assembleMovements); // 集結用の移動設定を適用

        const goal = new bot.pathfinder.goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1);

        try {
            currentAssembleTask = bot.pathfinder.goto(goal);
            await currentAssembleTask;
            currentAssembleTask = null;

            bot.chat(`[${bot.username}] 集結地に到着したよ！`);
        } catch (err) {
            currentAssembleTask = null;
            if (err.name === 'NoPath') {
                bot.chat(`[${bot.username}] 集結地への道が見つからないよ。`);
            } else if (err.name === 'GoalBreak') {
                bot.chat(`[${bot.username}] 集結中にゴールが中断されたよ。(移動中)`);
            } else if (err.name === 'PathStopped') {
                bot.chat(`[${bot.username}] 集結タスクが外部から停止されたよ。`);
            } else {
                bot.chat(`[${bot.username}] 集結中にエラーが発生したよ: ${err.message}`);
            }
        }
    }

    /**
     * 近くにあるチェストに持ち物を預ける関数
     */
    async function depositAllItemsInNearestChest() {
        if (!bot.collectBlock) {
            bot.chat(`[${bot.username}] collectBlockプラグインがロードされていません。`);
            return;
        }
        if (bot._isCollectingItems) { // collectBlockのフラグと共用
            bot.chat(`[${bot.username}] 既にアイテム回収または預け入れ中だよ。`);
            return;
        }

        // 現在の行動を中断
        if (typeof bot.stopAllActions === 'function') {
            bot.stopAllActions();
            bot.chat(`[${bot.username}] 現在のタスクを中断してアイテムを預けるよ。`);
        }

        bot._isCollectingItems = true; // アイテム操作中フラグをセット

        // 周囲でチェストを探す (最大32ブロック)
        const chestBlock = bot.findBlock({
            matching: block => bot.registry.blocksByName.chest.id === block.type,
            maxDistance: 32
        });

        if (!chestBlock) {
            bot.chat(`[${bot.username}] 近くにチェストが見つからないよ。`);
            bot._isCollectingItems = false;
            return;
        }

        bot.chat(`[${bot.username}] チェスト (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}) に向かうよ。`);

        try {
            await bot.pathfinder.goto(new bot.pathfinder.goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1));
            bot.chat(`[${bot.username}] チェストに到着したよ。`);

            // チェストを開く
            const chest = await bot.openContainer(chestBlock);
            bot.chat(`[${bot.username}] チェストを開いたよ。`);

            // インベントリ内のアイテムをすべて預ける (装備品は除く)
            for (const item of bot.inventory.items()) {
                // 装備品は預けない (Minecraft item type IDs for tools/armor are usually higher, 
                // or you can check item.slot for hotbar/equipment slots)
                // 例: 剣(283-286, 290-294), ツルハシ(257, 274, 278, 285), 防具(298-317)
                // 簡単なチェックとして、ホットバーや防具スロットのアイテムは除外
                if (item.slot >= 36 || item.type === bot.registry.itemsByName.air.id || item.name.includes('helmet') || item.name.includes('chestplate') || item.name.includes('leggings') || item.name.includes('boots') || item.name.includes('sword') || item.name.includes('pickaxe') || item.name.includes('axe') || item.name.includes('shovel') || item.name.includes('hoe')) {
                    continue; // ホットバーや装備スロット、特定のツールは預けない
                }
                
                await chest.deposit(item.type, null, item.count);
                bot.chat(`[${bot.username}] ${item.name} x${item.count} を預けたよ。`);
                await bot.waitForTicks(10); // 少し待機してサーバー負荷を軽減
            }
            
            await chest.close();
            bot.chat(`[${bot.username}] チェストを閉じたよ。預け入れ完了！`);

        } catch (err) {
            bot.chat(`[${bot.username}] チェスト操作中にエラーが発生したよ: ${err.message}`);
        } finally {
            bot._isCollectingItems = false; // アイテム操作中フラグをリセット
        }
    }

    // 各ボットファイルから呼び出せるように公開する（オプション）
    bot.assembleAtLocation = assembleAtLocation;
    bot.depositAllItemsInNearestChest = depositAllItemsInNearestChest;
};
