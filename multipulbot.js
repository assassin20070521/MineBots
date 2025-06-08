// start_all_bots.js

const { spawn } = require('child_process');
const path = require('path');

// --- 設定 ---
const NUM_MINING_BOTS = 1; // 採掘ボットの数
const NUM_GUARD_BOTS = 3;  // 剣ガードボットの数
const NUM_ARCHER_BOTS = 3;  // 弓ガードボットの数
const NUM_CUT_BOTS = 2;  // 木こりボットの数
const NUM_FISH_BOTS = 0;  // 釣りボットの数
const NUM_TORCH_BOTS = 1;  // トーチボットの数
const NUM_HOUSE_BOTS = 0;  // 家ボットの数
const NUM_HUNTER_BOTS = 1;  // 狩人ボットの数
const NUM_GRASS_BOTS = 1;  // 草刈りボットの数


// 各ボットのベースとなるスクリプトのパス
// このスクリプトと同じディレクトリにあることを前提とします。
const MINING_BOT_SCRIPT_PATH = path.join(__dirname, 'mining3.js');
const GUARD_BOT_SCRIPT_PATH = path.join(__dirname, 'guard2.js');
const ARCHER_BOT_SCRIPT_PATH = path.join(__dirname, 'guard4.js');
const CUT_BOT_SCRIPT_PATH = path.join(__dirname, 'tree.js');
const FISH_BOT_SCRIPT_PATH = path.join(__dirname, 'fishing.js');
const TORCH_BOT_SCRIPT_PATH = path.join(__dirname, 'torch_bot.js');
const HOUSE_BOT_SCRIPT_PATH = path.join(__dirname, 'house.js');
// 修正: hunter.jsとgrass.jsのパスを追加
const HUNTER_BOT_SCRIPT_PATH = path.join(__dirname, 's_attack.js'); // ファイル名を合わせる
const GRASS_BOT_SCRIPT_PATH = path.join(__dirname, 'grass.js'); // ファイル名を合わせる

const bots = []; // 起動したすべての子プロセスを保持する配列

console.log(` ${NUM_MINING_BOTS}体の採掘ボットと ${NUM_GUARD_BOTS}体の剣ボットを起動します...`);
console.log(` ${NUM_ARCHER_BOTS}体の弓ボットと ${NUM_CUT_BOTS}体の木こりボットを起動します...`);
console.log(` ${NUM_FISH_BOTS}体の釣りボットと ${NUM_TORCH_BOTS}体の湧きつぶしボットを起動します...`);
console.log(` ${NUM_HOUSE_BOTS}体の家ボットと ${NUM_HUNTER_BOTS}体の狩人ボットを起動します...`); // 新しいログ
console.log(` ${NUM_GRASS_BOTS}体の草刈りボットを起動します...`); // 新しいログ

/**
 * 指定されたスクリプトと設定でボットプロセスを起動するヘルパー関数
 * @param {string} scriptPath - 起動するボットスクリプトのパス
 * @param {string} namePrefix - ボット名のプレフィックス (例: 'AutoMiner')
 * @param {number} count - 起動するボットの数
 */
function launchBots(scriptPath, namePrefix, count) {
    for (let i = 1; i <= count; i++) {
        const botName = `${namePrefix}${i}`; // ユニークなユーザー名
        console.log(`ボット ${botName} を起動中...`);

        // 各ボットスクリプトは、コマンドライン引数でホスト、ポート、ユーザー名を
        // 受け取るように設計されている場合が多いため、引数を渡す
        // 現状のbot_animal_hunter.jsとbot_grass_harvester.jsは固定値なので、
        // この引数は内部で使われませんが、念のため渡しておきます。
        // （将来的に引数で設定する可能性を考慮）
        const botProcess = spawn('node', [
            scriptPath,
            // サーバー設定をコマンドライン引数で渡す場合はここに記述
            // 例えば、ボットスクリプト側で process.argv[2], process.argv[3] で読み込む場合
            'localhost', // ホスト名
            '25565',     // ポート
            botName      // ユーザー名
        ], {
            stdio: 'inherit', // 子プロセスの出力を親プロセスに継承
            // 環境変数でユーザー名を渡す（スクリプト側で process.env.BOT_USERNAME で読み込む場合）
            // 両方渡しておけば、どちらの方式でも対応可能
            env: { ...process.env, BOT_USERNAME: botName }
        });

        botProcess.on('error', (err) => {
            console.error(`ボット ${botName} の起動エラー:`, err);
        });
        botProcess.on('exit', (code, signal) => {
            console.log(`ボット ${botName} が終了しました。コード: ${code}, シグナル: ${signal}`);
        });

        bots.push(botProcess);
    }
}

// --- 各種ボットの起動 ---
launchBots(MINING_BOT_SCRIPT_PATH, 'AutoMiner', NUM_MINING_BOTS);
launchBots(GUARD_BOT_SCRIPT_PATH, 'GuardBot', NUM_GUARD_BOTS);
launchBots(ARCHER_BOT_SCRIPT_PATH, 'ArcherBot', NUM_ARCHER_BOTS);
launchBots(CUT_BOT_SCRIPT_PATH, 'TreeCutBot', NUM_CUT_BOTS);
launchBots(FISH_BOT_SCRIPT_PATH, 'FishBot', NUM_FISH_BOTS);
launchBots(TORCH_BOT_SCRIPT_PATH, 'TorchBot', NUM_TORCH_BOTS);
launchBots(HOUSE_BOT_SCRIPT_PATH, 'HouseBuilder', NUM_HOUSE_BOTS); // 家ボットを起動
launchBots(HUNTER_BOT_SCRIPT_PATH, 'AnimalHunter', NUM_HUNTER_BOTS); // 狩人ボットを起動
launchBots(GRASS_BOT_SCRIPT_PATH, 'GrassCutter', NUM_GRASS_BOTS); // 草刈りボットを起動



console.log('すべてのボットの起動コマンドが送信されました。');

// --- プロセス終了時のクリーンアップ ---
process.on('exit', () => {
    console.log('親プロセスが終了します。子ボットプロセスを終了中...');
    bots.forEach(bot => {
        if (!bot.killed) {
            bot.kill('SIGTERM'); // 終了シグナルを送信
        }
    });
});

process.on('SIGINT', () => { // Ctrl+C を捕捉
    console.log('Ctrl+C を検出しました。子ボットプロセスを終了中...');
    bots.forEach(bot => {
        if (!bot.killed) {
            bot.kill('SIGINT'); // 子プロセスにも SIGINT を送信
        }
    });
    process.exit(); // 親プロセスも終了
});