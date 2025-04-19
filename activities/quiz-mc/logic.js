// Load multiple question sets
const questionSets = {
  biology: require('./biology.json'),
  math: require('./math.json'),
  chinese: require('./chinese.json')
};
const setNames = Object.keys(questionSets);
// Current active questions
let questions = [];

module.exports = function(nsp) {
  let teacherSocket = null;
  let currentQuestionIndex = -1;
  let questionStartTime = 0;
  let questionDeadline = 0;
  let studentAnswers = {};

  nsp.on('connection', (socket) => {
    const { role, studentId, name } = socket.handshake.query || {};
    if (role === 'teacher') {
      teacherSocket = socket;
      // send available quiz sets to teacher
      socket.emit('sets', setNames);
      // teacher selects a quiz set
      socket.on('selectSet', (setName) => {
        if (!questionSets[setName]) {
          socket.emit('error', 'Invalid set: ' + setName);
          return;
        }
        questions = questionSets[setName];
        // notify teacher of loaded questions
        socket.emit('questions', questions);
      });
      socket.on('startQuestion', (index) => {
        index = parseInt(index);
        if (isNaN(index) || index < 0 || index >= questions.length) {
          return;
        }
        currentQuestionIndex = index;
        studentAnswers = {};
        questionStartTime = Date.now();
        const question = questions[currentQuestionIndex];
        const time = question.time || 30;
        questionDeadline = questionStartTime + time * 1000;
        nsp.emit('questionStarted', {
          questionIndex: currentQuestionIndex,
          question: question.question,
          options: question.options,
          time: time
        });
        setTimeout(() => {
          const stats = computeStats();
          nsp.emit('questionEnded', { stats });
        }, time * 1000 + 50);
      });
      // teacher ends the activity for this namespace
      socket.on('endActivity', () => {
        nsp.emit('activityEnded');
      });
      socket.on('disconnect', () => {
        teacherSocket = null;
      });
    } else if (role === 'student') {
      // if student joins mid-question, send current question
      const now = Date.now();
      if (typeof currentQuestionIndex === 'number' && currentQuestionIndex >= 0 && now <= questionDeadline) {
        const q = questions[currentQuestionIndex];
        const remainingTime = Math.ceil((questionDeadline - now) / 1000);
        socket.emit('questionStarted', {
          questionIndex: currentQuestionIndex,
          question: q.question,
          options: q.options,
          time: remainingTime
        });
      }
      socket.on('submitAnswer', (answerIndex) => {
        const now = Date.now();
        if (currentQuestionIndex < 0 || now > questionDeadline) {
          socket.emit('answerRejected', 'Time is up');
          return;
        }
        const sid = studentId;
        if (!sid) {
          socket.emit('answerRejected', 'Missing student ID');
          return;
        }
        if (studentAnswers[sid]) {
          socket.emit('answerRejected', 'Already answered');
          return;
        }
        const question = questions[currentQuestionIndex];
        const correct = parseInt(answerIndex) === question.answer;
        studentAnswers[sid] = {
          answerIndex: parseInt(answerIndex),
          time: now - questionStartTime,
          correct: correct,
          name: name
        };
        socket.emit('answerReceived');
        if (teacherSocket) {
          teacherSocket.emit('studentAnswered', {
            studentId: sid,
            name: name,
            answerIndex: parseInt(answerIndex),
            correct: correct,
            time: now - questionStartTime
          });
        }
      });
    }
  });

  function computeStats() {
    const counts = {};
    const question = questions[currentQuestionIndex];
    for (let i = 0; i < question.options.length; i++) {
      counts[i] = 0;
    }
    Object.values(studentAnswers).forEach(ans => {
      if (counts[ans.answerIndex] !== undefined) {
        counts[ans.answerIndex]++;
      }
    });
    const fastest = Object.entries(studentAnswers)
      .filter(([_, ans]) => ans.correct)
      .sort((a, b) => a[1].time - b[1].time)
      .slice(0, 3)
      .map(([sid, ans]) => ({ studentId: sid, name: ans.name, time: ans.time }));
    return { counts, fastest };
  }
};