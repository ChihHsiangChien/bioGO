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
      initialFish: 100,
      growthRate: 0.2,
      minFishPerFamily: 2,
      fishPrice: 10,
      showLastTurnStats: false, // Controls student visibility
      showFishChart: false     // Controls student visibility
    };
  }

  let gameConfig = { ...defaultConfig };
  let fishPool = gameConfig.initialFish; // Initialize fishPool from config
  let turn = 0;
  const students = {}; // Store student data by socket.id
  // submissionOrder is no longer needed for FCFS distribution logic

  function getStudentPublicData(student) {
    if (!student) return null;
    return {
      studentId: student.studentId,
      name: student.name,
      money: student.money || 0,
      catchThisTurn: student.catchThisTurn || 0, // Actual catch *processed* during this turn
      totalCatch: student.totalCatch || 0,
      submitted: student.submitted || false, // Has submitted for the *current* turn
      requestedCatch: student.requestedCatch || 0 // Requested catch for *current* turn (might differ from actual)
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
        turn
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
          fishPool: gameConfig.showFishChart ? fishPool : undefined
      });
  }


  function startTurn() {
    // Reset turn-specific student state
    Object.values(students).forEach(s => {
      if (s) {
        s.catchThisTurn = 0; // Reset actual catch *for this turn*
        s.requestedCatch = 0;
        s.submitted = false;
      }
    });

    // Apply fish growth *before* the turn starts
    if (turn > 0) {
        fishPool = Math.max(0, Math.round(fishPool * (1 + gameConfig.growthRate)));
    }

    nsp.emit('turnStarted', {
      turn,
      config: gameConfig,
      fishPool: gameConfig.showFishChart ? fishPool : undefined // Send initial pool if visible
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
      showFishChart: gameConfig.showFishChart,
      showLastTurnStats: gameConfig.showLastTurnStats
    });

    // Update teacher view one last time for the ended turn before growth/reset
    sendStudentList();

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

        teacherSocket.emit('config', gameConfig); // Confirm config back to teacher
        broadcastGameState(); // Send update to students (for their UI toggles)
        sendStudentList(); // Update teacher view (e.g., if fishPool changed)
      });

      socket.on('startGame', () => {
        console.log("[Commons Logic] Teacher startGame");
        fishPool = gameConfig.initialFish;
        turn = 1;
        Object.values(students).forEach(s => {
          if (s) {
            s.money = 0;
            s.totalCatch = 0;
            s.catchThisTurn = 0;
            s.requestedCatch = 0;
            s.submitted = false;
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
                socket: socket, studentId, name, money: 0, totalCatch: 0,
                catchThisTurn: 0, requestedCatch: 0, submitted: false
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
               submitted: studentEntry.submitted, requestedCatch: studentEntry.requestedCatch
           });
       } else {
            socket.emit('waiting');
       }
      sendStudentList();

      // *** MODIFIED submitCatch Handler for Immediate Processing ***
      socket.on('submitCatch', requestedAmount => {
        const student = students[socket.id];
        if (!student || student.submitted || turn === 0) {
            console.log(`[Commons Logic] Invalid submitCatch from ${student?.name || socket.id}. Submitted: ${student?.submitted}, Turn: ${turn}`);
            // Optional: Send back an error message?
            // socket.emit('catchError', { message: 'Submission invalid or already submitted.' });
            return;
        }

        const requested = Math.max(0, parseInt(requestedAmount) || 0);
        student.requestedCatch = requested; // Store what they asked for
        student.submitted = true; // Mark as submitted for this turn

        // --- Immediate Processing Logic ---
        let actualCatch = 0;
        let moneyEarned = 0;

        // Check available fish *now*
        if (fishPool > 0) {
            actualCatch = Math.min(requested, fishPool); // Grant up to what's available
            fishPool -= actualCatch; // Deduct immediately
        } else {
            actualCatch = 0; // No fish left
        }

        student.catchThisTurn = actualCatch; // Record actual catch for this turn

        // Calculate money earned based on actual catch
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
            nsp.emit('gameEnded', {
                finalStats: Object.values(students).map(getStudentPublicData).filter(s => s !== null),
                fishPool: 0
            });
            turn = 0; // Reset turn
        }
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
