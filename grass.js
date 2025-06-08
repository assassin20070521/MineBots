const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const fs = require('fs');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'GrassBot',
});

bot.loadPlugin(pathfinder);

let defaultMove;
let mcData;

bot.once('spawn', () => {
  mcData = require('minecraft-data')(bot.version);
  defaultMove = new Movements(bot, mcData);
  defaultMove.scafoldingBlocks.push(mcData.blocksByName.dirt.id); // 土を足場に使う

  bot.pathfinder.setMovements(defaultMove);

  console.log('GrassBot がスポーンしました！');

  startGrassLoop();
});

// 死亡後に自動復帰（リスポーン）
bot.on('death', () => {
  console.log('死んだのでリスポーンを待ちます...');
});

bot.on('respawn', () => {
  console.log('リスポーンしました！再開します...');
  if (mcData === undefined) {
    mcData = require('minecraft-data')(bot.version);
    defaultMove = new Movements(bot, mcData);
    defaultMove.scafoldingBlocks.push(mcData.blocksByName.dirt.id);
    bot.pathfinder.setMovements(defaultMove);
  }
  startGrassLoop();
});

// 草を探して刈るループ
function startGrassLoop() {
  setInterval(() => {
    const tallGrass = bot.findBlock({
      matching: (block) => block && block.name === 'tall_grass',
      maxDistance: 32,
    });

    if (!tallGrass) {
      console.log('草が見つかりませんでした。');
      return;
    }

    console.log(`草を発見: ${tallGrass.position}`);
    bot.pathfinder.setGoal(new goals.GoalBlock(
      tallGrass.position.x,
      tallGrass.position.y,
      tallGrass.position.z
    ));

    bot.once('goal_reached', async () => {
      try {
        await bot.dig(tallGrass);
        console.log('草を刈りました。');
      } catch (err) {
        console.log('草を刈れませんでした:', err.message);
      }
    });
  }, 5000); // 5秒おきに探索・草刈り
}
