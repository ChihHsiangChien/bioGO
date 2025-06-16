// Tragedy of the Commons simulation logic
const path = require('path'); // Standard way to require path
const fs = require('fs');     // Standard way to require fs

module.exports = function(nsp) {
  let teacherSocket = null;
  // Load default config safely
  let defaultConfig = {};
  try {
    defaultConfig = require(path.join(__dirname, 'config.json'));
  } catch (e) {
    console.warn("[Commons Logic] config.json not found or invalid. Using hardcoded defaults.");
    defaultConfig = {
      initialFish: 1000,
      growthRate: 0.2,
      fishPrice: 10,
      minFishPerFamily: 2,
      showLastTurnStats: false,    // Controls student visibility
      showFishChart: false,       // Controls student visibility
      showTotalCatchLimit: false, // 顯示是否總量管制
      totalCatchLimit: 100,       // 總漁獲管制
      enablePersonalCatchLimit: false, // 是否啟用個人上限
      totalCatchesPerTurn: [], // Array to store total catch for each turn
      enablePublicInvestment: false, 
      maintenanceInvestmentUnit: 100, // Cost per unit of maintenance investment
      maintenanceGrowthBonus: 0.01,  // Growth rate bonus per unit (e.g., 0.01 for 1%)
      stockingInvestmentUnit: 1,    // Cost per unit of stocking investment
      stockingFishBonus: 1,          // Fish added per unit of stocking
      personalCatchLimitValue: 50    // 個人捕撈上限
    };
  }

  let gameConfig = { ...defaultConfig };
  let fishPool = gameConfig.initialFish; // Initialize fishPool from config
  let turn = 0;
  let turnCatchRemaining = gameConfig.totalCatchLimit; // Reset each turn
  const students = {}; // Store student data by socket.id
  let totalMaintenanceInvestmentThisTurn = 0;
  let totalStockingInvestmentThisTurn = 0;  
  // submissionOrder is no longer needed for FCFS distribution logic

  function getStudentPublicData(student) {
    if (!student) return null;
    return {
      studentId: student.studentId,
      name: student.name,
      money: student.money || 0,
      catchThisTurn: student.catchThisTurn || 0,
      totalCatch: student.totalCatch || 0,
      submitted: student.submitted || false,
      requestedCatch: student.requestedCatch || 0,
      banCount: student.banCount || 0,
      investmentMaintenanceThisTurn: student.investmentMaintenanceThisTurn || 0,
      investmentStockingThisTurn: student.investmentStockingThisTurn || 0

    };
  }


  function sendStudentList() {
    if (teacherSocket) {
      const studentListData = Object.values(students).map(getStudentPublicData).filter(s => s !== null);
      const uniqueStudents = [];
      const seenIds = new Set();
      studentListData.forEach(s => {
          if (!seenIds.has(s.studentId)) {
              seenIds.add(s.studentId);
              uniqueStudents.push(s);
          }
      });

      // Send current state including actual catches processed so far this turn
      teacherSocket.emit('updateStudentList', {
        students: uniqueStudents,
        fishPool, // Send the *live* fish pool
        turn,
        totalCatchesPerTurn: gameConfig.totalCatchesPerTurn, // Send to teacher
        investmentSummary: {
            totalMaintenanceInvestmentThisTurn,
            totalStockingInvestmentThisTurn,
            studentInvestments: uniqueStudents.map(s => ({ name: s.name, investmentMaintenanceThisTurn: s.investmentMaintenanceThisTurn, investmentStockingThisTurn: s.investmentStockingThisTurn }))
        }
      });
    }
  }

  function broadcastGameState() {
      // Broadcast updates that might affect student view (like config toggles)
      nsp.emit('turnUpdate', {
          turn,
          config: gameConfig, // Send current config including toggles
          // Fish pool is sent live via sendStudentList to teacher,
          // and potentially via turnStarted/turnEnded to students if enabled
          fishPool: gameConfig.showFishChart ? fishPool : undefined,
          totalCatchesPerTurn: gameConfig.totalCatchesPerTurn, // Send to teacher at turn start
          investmentSummary: { // Send to teacher
              totalMaintenanceInvestmentThisTurn,
              totalStockingInvestmentThisTurn
          }
      });
  }


  function startTurn() {
    // Initialize turn catch quota
    turnCatchRemaining = gameConfig.totalCatchLimit;

    // 1. Calculate effective growth rate based on maintenance investment
    let effectiveGrowthRate = gameConfig.growthRate;
    if (gameConfig.maintenanceInvestmentUnit > 0 && totalMaintenanceInvestmentThisTurn > 0) {
        const maintenanceUnitsInvested = totalMaintenanceInvestmentThisTurn / gameConfig.maintenanceInvestmentUnit;
        const maintenanceBonus = maintenanceUnitsInvested * gameConfig.maintenanceGrowthBonus;
        // Optional: Add a cap to the bonus growth from maintenance
        // const cappedMaintenanceBonus = Math.min(0.10, maintenanceBonus); // e.g., max 10% bonus
        effectiveGrowthRate += maintenanceBonus; // Or cappedMaintenanceBonus
    }

    // 2. Apply fish growth *before* the turn starts, using effective rate
    if (turn > 0) {
        fishPool = Math.max(0, Math.round(fishPool * (1 + effectiveGrowthRate)));
    }
    // 3. Apply fish stocking based on investment
    if (gameConfig.stockingInvestmentUnit > 0 && totalStockingInvestmentThisTurn > 0) {
        const stockingUnitsInvested = totalStockingInvestmentThisTurn / gameConfig.stockingInvestmentUnit;
        const stockedFish = Math.floor(stockingUnitsInvested * gameConfig.stockingFishBonus);
        fishPool += stockedFish;
    }

    // Reset investments for the new turn (after their effects have been applied)
    totalMaintenanceInvestmentThisTurn = 0;
    totalStockingInvestmentThisTurn = 0;
    // Reset turn-specific student state for the new turn
    Object.values(students).forEach(s => {
      if (s) {
        s.catchThisTurn = 0; // Reset actual catch *for this turn*
        s.requestedCatch = 0;
        s.submitted = false;
        // Determine and set if the student is effectively banned for THIS turn
        s.isEffectivelyBannedThisTurn = (s.banCount > 0);
        s.investmentMaintenanceThisTurn = 0;
        s.investmentStockingThisTurn = 0;
      }
    });


    nsp.emit('turnStarted', {
      turn,
      config: gameConfig,
      fishPool: gameConfig.showFishChart ? fishPool : undefined, // Send initial pool if visible
      investmentSummary: { totalMaintenanceInvestmentThisTurn, totalStockingInvestmentThisTurn } // Send to teacher

    });
    // Send individual state update to each student, including banCount
    Object.values(students).forEach(s => {
      if (s && s.socket) { // Check if student object and socket exist
        s.socket.emit('studentStateUpdate', {
          money: s.money, totalCatch: s.totalCatch,
          submitted: s.submitted, requestedCatch: s.requestedCatch,
          banCount: s.banCount // Ensure banCount is sent
        });
      }
    });
    sendStudentList(); // Update teacher view at start of turn
  }

  // This function is no longer responsible for distribution,
  // but gathers the results recorded during the turn.
  function collectTurnResults() {
      const results = [];
       Object.values(students).forEach(student => {
           if (student) {
               results.push({
                   studentId: student.studentId,
                   name: student.name,
                   catchThisTurn: student.catchThisTurn || 0, // The actual catch processed
                   money: student.money || 0 // Final money after processing
               });
           }
       });
       return results;
  }


  function endTurn() {
    // Calculate total catch for this turn
    const totalCatchThisTurn = Object.values(students).reduce((sum, s) => sum + (s.catchThisTurn || 0), 0);
    if (!Array.isArray(gameConfig.totalCatchesPerTurn)) {
      gameConfig.totalCatchesPerTurn = []; // Safely initialize the array
    }
    gameConfig.totalCatchesPerTurn.push(totalCatchThisTurn);

    // Results were processed incrementally via 'submitCatch'
    const finalTurnStats = collectTurnResults(); // Get the stats as they ended up

    // Check for game end condition (no fish) - could happen mid-turn now
    if (fishPool <= 0) {
      nsp.emit('gameEnded', {
        finalStats: Object.values(students).map(getStudentPublicData).filter(s => s !== null),
        fishPool: 0
      });
      turn = 0;
      return;
    }

    // Emit turn ended event to all clients
    nsp.emit('turnEnded', {
      turn,
      fishPool: gameConfig.showFishChart ? fishPool : undefined, // Send final pool if visible
      stats: gameConfig.showLastTurnStats ? finalTurnStats : undefined, // Send collected stats if visible
      showFishChart: gameConfig.showFishChart, // Ensure correct flag
      totalCatchesPerTurn: gameConfig.totalCatchesPerTurn, // Send updated array
      showLastTurnStats: gameConfig.showLastTurnStats
    });

    // Update teacher view one last time for the ended turn before growth/reset
    sendStudentList();

    // Decrement fishing ban counters after turn ends
    // Only decrement if the student was actually banned and served it this turn
    Object.values(students).forEach(s => {
      if (s.isEffectivelyBannedThisTurn && s.banCount > 0) {
        s.banCount--;
      }
      delete s.isEffectivelyBannedThisTurn; // Clean up temporary flag
    });
    // Prepare for next turn
    turn++;
    startTurn(); // Applies growth, resets submission status, emits turnStarted
  }

  nsp.on('connection', socket => {
    const { role, studentId, name } = socket.handshake.query || {};
    console.log(`[Commons] Connection: role=${role}, studentId=${studentId}, name=${name}, socketId=${socket.id}`);

    if (role === 'teacher') {
      if (teacherSocket) {
        console.warn("[Commons Logic] Multiple teachers tried to connect. Disconnecting new one.");
        socket.disconnect(true);
        return;
      }
      teacherSocket = socket;
      console.log("[Commons Logic] Teacher connected:", socket.id);
      socket.emit('config', gameConfig);
      sendStudentList();

      socket.on('setConfig', newConfig => {
        console.log("[Commons Logic] Teacher setConfig:", newConfig);
        // Update specific editable fields
        if (newConfig.initialFish !== undefined && turn === 0) {
            gameConfig.initialFish = parseInt(newConfig.initialFish, 10) || gameConfig.initialFish;
            fishPool = gameConfig.initialFish;
        }
         if (newConfig.fishPool !== undefined) { // Allow direct fish pool update via "Update" button
             fishPool = Math.max(0, parseInt(newConfig.fishPool, 10) || 0);
         }
        if (newConfig.growthRate !== undefined) {
            let rate = parseFloat(newConfig.growthRate);
            if (!isNaN(rate) && rate >= 1) rate = rate / 100.0; // Convert % if needed
            gameConfig.growthRate = (!isNaN(rate) && rate >= 0) ? rate : gameConfig.growthRate;
        }
         if (newConfig.minFishPerFamily !== undefined) {
             gameConfig.minFishPerFamily = parseInt(newConfig.minFishPerFamily, 10) || gameConfig.minFishPerFamily;
         }
        if (newConfig.fishPrice !== undefined) {
            gameConfig.fishPrice = parseInt(newConfig.fishPrice, 10) || gameConfig.fishPrice;
        }
        // These flags now ONLY control student visibility
        if (newConfig.showLastTurnStats !== undefined) {
            gameConfig.showLastTurnStats = !!newConfig.showLastTurnStats;
        }
        if (newConfig.showFishChart !== undefined) {
            gameConfig.showFishChart = !!newConfig.showFishChart;
        }
        if (newConfig.showTotalCatchLimit !== undefined) {
            gameConfig.showTotalCatchLimit = !!newConfig.showTotalCatchLimit;
        }
        if (newConfig.totalCatchLimit !== undefined) {
            gameConfig.totalCatchLimit = parseInt(newConfig.totalCatchLimit, 10) || gameConfig.totalCatchLimit;
        }
        if (newConfig.enablePersonalCatchLimit !== undefined) { // New
            gameConfig.enablePersonalCatchLimit = !!newConfig.enablePersonalCatchLimit;
        }
        if (newConfig.personalCatchLimitValue !== undefined) { // New
            gameConfig.personalCatchLimitValue = parseInt(newConfig.personalCatchLimitValue, 10) || gameConfig.personalCatchLimitValue;
        }
        if (newConfig.enablePublicInvestment !== undefined) { // New
            gameConfig.enablePublicInvestment = !!newConfig.enablePublicInvestment;
        }
        if (newConfig.maintenanceInvestmentUnit !== undefined) {
            gameConfig.maintenanceInvestmentUnit = Math.max(1, parseInt(newConfig.maintenanceInvestmentUnit, 10) || gameConfig.maintenanceInvestmentUnit);
        }
        if (newConfig.maintenanceGrowthBonus !== undefined) {
            gameConfig.maintenanceGrowthBonus = Math.max(0, parseFloat(newConfig.maintenanceGrowthBonus) || gameConfig.maintenanceGrowthBonus);
        }
        if (newConfig.stockingInvestmentUnit !== undefined) {
            gameConfig.stockingInvestmentUnit = Math.max(1, parseInt(newConfig.stockingInvestmentUnit, 10) || gameConfig.stockingInvestmentUnit);
        }
        if (newConfig.stockingFishBonus !== undefined) {
            gameConfig.stockingFishBonus = Math.max(0, parseInt(newConfig.stockingFishBonus, 10) || gameConfig.stockingFishBonus);
        }
        // Reset total catches when settings are changed (new game effectively)
        gameConfig.totalCatchesPerTurn = [];
        // Reset investments as well if config changes imply a new game state
        
        teacherSocket.emit('config', gameConfig); // Confirm config back to teacher
        broadcastGameState(); // Send update to students (for their UI toggles)
        sendStudentList(); // Update teacher view (e.g., if fishPool changed)
      });
      // teacher sets fishing ban count for a student
      socket.on('setBan', ({ studentId, banCount }) => {
        console.log("[Commons Logic] Teacher setBan:", studentId, banCount);
        Object.values(students).forEach(s => {
          if (s.studentId === studentId) s.banCount = banCount;
        });
        sendStudentList(teacherSocket);
      });

      socket.on('startGame', () => {
        console.log("[Commons Logic] Teacher startGame");
        fishPool = gameConfig.initialFish;
        turn = 1;
        // initialize turn-based total catch quota
        turnCatchRemaining = gameConfig.totalCatchLimit;
        Object.values(students).forEach(s => {
          if (s) {
            s.money = 0;
            s.totalCatch = 0;
            s.catchThisTurn = 0;
            s.requestedCatch = 0;
            s.submitted = false;
            s.investmentMaintenanceThisTurn = 0;
            s.investmentStockingThisTurn = 0;            
          }
        });
        // Send gameStarted with initial state potentially visible to students
        nsp.emit('gameStarted', {
            config: gameConfig,
            fishPool: gameConfig.showFishChart ? fishPool : undefined
        });
        sendStudentList(); // Update teacher view
        startTurn(); // Start the first turn (applies growth=0, emits turnStarted)
      });

      socket.on('endTurn', () => {
        console.log("[Commons Logic] Teacher endTurn");
        endTurn(); // Processing now happens incrementally
      });

      socket.on('endGame', () => {
         console.log("[Commons Logic] Teacher endGame");
        nsp.emit('gameEnded', {
          finalStats: Object.values(students).map(getStudentPublicData).filter(s => s !== null),
          fishPool
        });
        turn = 0;
      });

      socket.on('disconnect', () => {
        console.log("[Commons Logic] Teacher disconnected:", socket.id);
        teacherSocket = null;
      });

    } else if (role === 'student' && studentId && name) {
        // --- Student connection/reconnection logic (remains the same) ---
        let studentEntry = students[socket.id];
        if (!studentEntry) {
             const existingSocketId = Object.keys(students).find(id => students[id]?.studentId === studentId);
             if (existingSocketId) {
                 console.log(`[Commons Logic] Student ${name} (${studentId}) reconnected. Updating socket ID from ${existingSocketId} to ${socket.id}.`);
                 studentEntry = students[existingSocketId];
                 delete students[existingSocketId];
                 students[socket.id] = studentEntry;
             }
        }
        if (studentEntry) {
             console.log(`[Commons Logic] Student ${name} (${studentId}) already known or reconnected. Updating socket reference.`);
             studentEntry.socket = socket;
             studentEntry.name = name;
        } else {
            console.log(`[Commons Logic] Student ${name} (${studentId}) connected with socket ${socket.id}`);
            students[socket.id] = {
                socket: socket,
                studentId,
                name,
                money: 0,
                totalCatch: 0,
                catchThisTurn: 0,
                requestedCatch: 0,
                submitted: false,
                banCount: 0,
                investmentMaintenanceThisTurn: 0,
                investmentStockingThisTurn: 0
            };
            studentEntry = students[socket.id];
        }
        // --- End Student connection/reconnection logic ---

      socket.emit('loginSuccess', { studentId, name });
       if (turn > 0) {
           socket.emit('turnStarted', {
               turn, config: gameConfig,
               fishPool: gameConfig.showFishChart ? fishPool : undefined
           });
           socket.emit('studentStateUpdate', {
               money: studentEntry.money, totalCatch: studentEntry.totalCatch,
               submitted: studentEntry.submitted, requestedCatch: studentEntry.requestedCatch,
               banCount: studentEntry.banCount // Add banCount here for connecting students
           });
       } else {
            socket.emit('waiting');
       }
      sendStudentList();

      // *** MODIFIED submitCatch Handler for Immediate Processing ***
      socket.on('submitCatch', requestedAmount => {
        const student = students[socket.id];

        // --- DETAILED VALIDATION LOGGING ---
        if (!student) {
            console.error(`[Commons Logic] Invalid submitCatch: No student data found for socket ${socket.id}.`);
            // Optional: Send error back to student
            socket.emit('catchError', { message: 'Server error: Could not find your session. Please refresh.' });
            return;
        }
        if (student.submitted) {
            console.warn(`[Commons Logic] Invalid submitCatch: Student ${student.name} (${student.studentId}) already submitted for turn ${turn}.`);
            // Optional: Send error back to student
            socket.emit('catchError', { message: 'You have already submitted for this turn.' });
            return;
        }
        if (turn === 0) {
            console.warn(`[Commons Logic] Invalid submitCatch: Game not started or has ended (turn is 0).`);
            // Optional: Send error back to student
            socket.emit('catchError', { message: 'Submission failed: The game is not currently active.' });
            return;
        }
        // --- END DETAILED VALIDATION ---


        const requested = Math.max(0, parseInt(requestedAmount) || 0);
        // Ensure students catch at least the minimum required per family
        if (requested < gameConfig.minFishPerFamily) {
            socket.emit('catchError', { message: `提交失敗：今年至少要捕 ${gameConfig.minFishPerFamily} 條魚。` });
            return;
        }
        student.requestedCatch = requested; // Store what they asked for
        student.submitted = true; // Mark as submitted for this turn

        // --- Immediate Processing Logic ---
        // ... (rest of the processing logic remains the same) ...
        // Enforce fishing ban and total catch quota per turn
        let actualCatch = 0;
        let moneyEarned = 0;
        // Check the ban status determined at the start of the turn
        if (student.isEffectivelyBannedThisTurn) {
            actualCatch = 0;
            // The error message should still use student.banCount as it reflects the sentence including the current turn
            socket.emit('catchError', { message: `您本回合被禁漁，無法捕魚。剩餘禁漁 ${student.banCount} 回合。` });
        } else if (turnCatchRemaining > 0 && fishPool > 0) {
            let effectiveTurnCatchRemaining = Infinity; // Default to no limit if total limit is not enabled
            if (gameConfig.showTotalCatchLimit) { // Check if total catch limit is enabled
                effectiveTurnCatchRemaining = turnCatchRemaining;
            }

            let maxAllowedByPersonalLimit = Infinity;
            if (gameConfig.enablePersonalCatchLimit) {
                maxAllowedByPersonalLimit = gameConfig.personalCatchLimitValue;
            }
            actualCatch = Math.min(requested, fishPool, effectiveTurnCatchRemaining, maxAllowedByPersonalLimit);

            fishPool -= actualCatch;
            if (gameConfig.showTotalCatchLimit) { // Only decrement if the limit is active
                turnCatchRemaining -= actualCatch;
            }
        } else {
            actualCatch = 0;
        }
        student.catchThisTurn = actualCatch;
        const surplusFish = Math.max(0, actualCatch - gameConfig.minFishPerFamily);
        moneyEarned = surplusFish * gameConfig.fishPrice;
        student.money = (student.money || 0) + moneyEarned;
        student.totalCatch = (student.totalCatch || 0) + actualCatch;
        // --- End Immediate Processing Logic ---

        console.log(`[Commons Logic] Student ${student.name} requested ${requested}, caught ${actualCatch}. Pool: ${fishPool}. Money: ${student.money}`);

        // *** Emit immediate result back to the student ***
        socket.emit('catchProcessed', { // Using a new event name for clarity
            requested: requested,
            catchAmount: actualCatch,
            moneyEarned: moneyEarned,
            totalMoney: student.money,
            totalCatch: student.totalCatch,
            minFishRequired: gameConfig.minFishPerFamily,
            currentFishPool: fishPool // Send updated pool state
        });

        // Update teacher view immediately with the new state
        sendStudentList();

        // Check for game end condition immediately after catch
        if (fishPool <= 0) {
            console.log("[Commons Logic] Fish pool depleted mid-turn. Ending game.");
            // Ensure the final turn's catch is recorded before ending
            const finalCatchThisTurn = Object.values(students).reduce((sum, s) => sum + (s.catchThisTurn || 0), 0);
            if (!Array.isArray(gameConfig.totalCatchesPerTurn)) {
                gameConfig.totalCatchesPerTurn = [];
            }
            // Add this potentially partial turn's catch data
            gameConfig.totalCatchesPerTurn.push(finalCatchThisTurn);
            nsp.emit('gameEnded', {
                finalStats: Object.values(students).map(getStudentPublicData).filter(s => s !== null),
                fishPool: 0,
                totalCatchesPerTurn: gameConfig.totalCatchesPerTurn // Send the final array
            });
            turn = 0; // Reset turn
        }
      });
      socket.on('investMaintenance', amount => {
        const student = students[socket.id];
        if (!student || turn === 0 || !student.submitted || student.investmentMaintenanceThisTurn > 0) {
            socket.emit('investmentProcessed', { success: false, message: '現在無法投資魚池維護。', newMoney: student ? student.money : 0, type: 'maintenance' });
            return;
        }
        const cost = Math.max(0, parseInt(amount) || 0);
        if (student.money < cost) {
            socket.emit('investmentProcessed', { success: false, message: '財產不足，無法投資。', newMoney: student.money, type: 'maintenance' });
            return;
        }
        student.money -= cost;
        student.investmentMaintenanceThisTurn = (student.investmentMaintenanceThisTurn || 0) + cost;
        totalMaintenanceInvestmentThisTurn += cost;
        socket.emit('investmentProcessed', { success: true, message: `成功投資魚池維護 $${cost}。`, newMoney: student.money, type: 'maintenance' });
        sendStudentList(); // Update teacher
        broadcastGameState(); // Update investment summary for teacher
      });

      socket.on('investStocking', amount => {
        const student = students[socket.id];
        if (!gameConfig.enablePublicInvestment || !student || turn === 0 || !student.submitted || student.investmentStockingThisTurn > 0) {
            socket.emit('investmentProcessed', { success: false, message: '現在無法投資魚苗放養。', newMoney: student ? student.money : 0, type: 'stocking' });
            return;
        }
        const cost = Math.max(0, parseInt(amount) || 0);
        if (student.money < cost) {
            socket.emit('investmentProcessed', { success: false, message: '財產不足，無法投資。', newMoney: student.money, type: 'stocking' });
            return;
        }
        student.money -= cost;
        student.investmentStockingThisTurn = (student.investmentStockingThisTurn || 0) + cost;
        totalStockingInvestmentThisTurn += cost;
        socket.emit('investmentProcessed', { success: true, message: `成功投資魚苗放養 $${cost}。`, newMoney: student.money, type: 'stocking' });
        sendStudentList(); // Update teacher
        broadcastGameState(); // Update investment summary for teacher
      });

      socket.on('disconnect', () => {
        const s = students[socket.id];
        if (s) {
            console.log(`[Commons Logic] Student ${s.name} (${s.studentId}) disconnected with socket ${socket.id}`);
             s.socket = null;
        } else {
            console.log(`[Commons Logic] Unknown student disconnected with socket ${socket.id}`);
        }
        // No submissionOrder to modify
        // Update teacher view *after* potential cleanup
        sendStudentList();
      });
    } else {
        console.log(`[Commons Logic] Invalid connection attempt. Role: ${role}, ID: ${studentId}, Name: ${name}`);
        socket.disconnect(true);
    }
  });

  console.log("[Commons Logic] Namespace handler initialized.");
};
