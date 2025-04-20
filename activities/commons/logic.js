// Tragedy of the Commons simulation logic
const path = require('path');
const fs = require('fs');

module.exports = function(nsp) {
  let teacherSocket = null;
  // load boats config
  const boatsConfig = require(path.join(__dirname, 'boats.json')).boats;
  // load default game config
  const defaultConfig = require(path.join(__dirname, 'config.json'));
  let gameConfig = { ...defaultConfig };
  // game state
  let fishPool = 0;
  let turn = 0;
  let results = []; // per-student cumulative
  let timer = null;
  const students = {}; // socket.id -> { studentId, name, money, boatIndex, totalCatch, catchThisTurn }

  // helper to broadcast student list to teacher
  function sendStudentList() {
    if (teacherSocket) {
      const unique = [];
      const seen = new Set();
      Object.values(students).forEach(s => {
        if (!seen.has(s.studentId)) {
          seen.add(s.studentId);
          unique.push({ studentId: s.studentId, name: s.name, money: s.money, boat: boatsConfig[s.boatIndex].name, lastCatch: s.catchThisTurn });
        }
      });
      teacherSocket.emit('updateStudentList', { students: unique, fishPool, turn });
    }
  }

  function startTurn() {
    // clear previous catches
    Object.values(students).forEach(s => { s.catchThisTurn = 0; });
    // notify students to catch
    nsp.emit('turnStarted', { turn, config: gameConfig, fishPool });
    // if turnDuration, start timer to auto-end
    if (gameConfig.turnDuration > 0) {
      timer = setTimeout(() => endTurn(), gameConfig.turnDuration * 1000);
    }
  }

  function endTurn() {
    if (timer) clearTimeout(timer);
    // compute total planned catch
    let totalPlanned = 0;
    Object.values(students).forEach(s => { totalPlanned += s.catchThisTurn; });
    // determine actual catches
    const actualCatches = {};
    if (totalPlanned <= fishPool) {
      Object.values(students).forEach(s => {
        actualCatches[s.studentId] = s.catchThisTurn;
      });
    } else {
      // proportionally allocate
      Object.values(students).forEach(s => {
        const prop = s.catchThisTurn / totalPlanned;
        actualCatches[s.studentId] = Math.floor(prop * fishPool);
      });
    }
    // sum actual
    const totalActual = Object.values(actualCatches).reduce((a,b) => a + b, 0);
    // update fish pool with depletion and growth
    const remaining = Math.max(0, fishPool - totalActual);
    fishPool = remaining + Math.round(remaining * gameConfig.growthRate);
    // update student money and totals
    Object.values(students).forEach(s => {
      const actual = actualCatches[s.studentId] || 0;
      s.money += actual;
      s.totalCatch += actual;
      s.catchThisTurn = actual; // overwrite to actual for reporting
    });
    // prepare stats per student
    const stats = Object.values(students).map(s => ({ studentId: s.studentId, name: s.name, planned: s.catchThisTurn, actual: s.catchThisTurn, money: s.money, boat: boatsConfig[s.boatIndex].name }));
    // broadcast turn result
    nsp.emit('turnEnded', {
      turn,
      fishPool: gameConfig.showRemainingFish ? fishPool : undefined,
      totalPlanned: gameConfig.showTotalCatch ? totalPlanned : undefined,
      totalActual: gameConfig.showTotalCatch ? totalActual : undefined,
      stats
    });
    sendStudentList();
    // next or end game
    if (turn < gameConfig.turnLimit) {
      turn++;
      // automatically start next turn
      startTurn();
    } else {
      // game over
      nsp.emit('gameEnded', { finalStats: stats, fishPool });
    }
  }

  nsp.on('connection', socket => {
    const { role, studentId, name } = socket.handshake.query || {};
    if (role === 'teacher') {
      teacherSocket = socket;
      // send current config
      socket.emit('config', gameConfig);
      // teacher sets config
      socket.on('setConfig', config => {
        gameConfig = { ...defaultConfig, ...config };
        socket.emit('config', gameConfig);
        // notify students of config change mid-game
        nsp.emit('configChanged', gameConfig);
      });
      // teacher starts game
      socket.on('startGame', () => {
        // initialize state
        fishPool = gameConfig.initialFish;
        turn = 1;
        Object.values(students).forEach(s => {
          s.money = 0;
          s.boatIndex = 0;
          s.totalCatch = 0;
          s.catchThisTurn = 0;
        });
        console.log('[Commons] startGame received, broadcasting gameStarted to students');
        // broadcast game start including boats info
        nsp.emit('gameStarted', { config: gameConfig, fishPool, boats: boatsConfig });
        // notify waiting students (default namespace) to join commons activity
        const io = nsp.server;
        io.of('/').emit('activityLaunched', { activity: 'commons' });
        sendStudentList();
        startTurn();
      });
      // teacher ends current turn
      socket.on('endTurn', () => endTurn());
      // teacher ends game
      socket.on('endGame', () => {
        if (timer) clearTimeout(timer);
        const finalStats = Object.values(students).map(s => ({ studentId: s.studentId, name: s.name, totalCatch: s.totalCatch, money: s.money, boat: boatsConfig[s.boatIndex].name }));
        nsp.emit('gameEnded', { finalStats, fishPool });
      });
      socket.on('disconnect', () => { teacherSocket = null; });
    } else if (role === 'student') {
      // default role assign
      students[socket.id] = { studentId, name, money: 0, boatIndex: 0, totalCatch: 0, catchThisTurn: 0 };
      socket.emit('loginSuccess', { studentId, name });
      // notify teacher of new student
      sendStudentList();
      socket.on('submitCatch', n => {
        const s = students[socket.id];
        const max = boatsConfig[s.boatIndex].maxCatch;
        const amt = Math.min(Math.max(0, parseInt(n,10)), max);
        s.catchThisTurn = amt;
        socket.emit('catchReceived', amt);
        // notify teacher of planned catch
        if (teacherSocket) {
          teacherSocket.emit('studentPlanned', { studentId: s.studentId, name: s.name, planned: amt });
        }
      });
      socket.on('upgradeBoat', idx => {
        const s = students[socket.id];
        const i = parseInt(idx,10);
        if (i >=0 && i < boatsConfig.length && s.money >= boatsConfig[i].price) {
          s.money -= boatsConfig[i].price;
          s.boatIndex = i;
          socket.emit('upgradeSuccess', { boat: boatsConfig[i].name, money: s.money });
          sendStudentList();
        } else {
          socket.emit('upgradeFailed', 'Insufficient funds or invalid boat');
        }
      });
      socket.on('disconnect', () => {
        delete students[socket.id];
        sendStudentList();
      });
    }
  });
};