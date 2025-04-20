// Poll activity logic
module.exports = function(nsp) {
  let teacherSocket = null;
  let pollData = null; // { question: string, options: [] }
  let responses = {}; // studentId -> { optionIndex, name }

  nsp.on('connection', (socket) => {
    const { role, studentId, name } = socket.handshake.query || {};
    if (role === 'teacher') {
      teacherSocket = socket;
      // start a new poll with question and options
      socket.on('startPoll', (data) => {
        if (!data || !data.question || !Array.isArray(data.options) || data.options.length < 2) {
          socket.emit('error', 'Invalid poll data');
          return;
        }
        pollData = { question: data.question, options: data.options };
        responses = {};
        nsp.emit('pollStarted', pollData);
      });
      // end the current poll (show final stats)
      socket.on('endPoll', () => {
        if (!pollData) return;
        const stats = computeStats();
        nsp.emit('pollEnded', { stats });
      });
      // end the activity entirely
      socket.on('endActivity', () => {
        nsp.emit('activityEnded');
      });
      socket.on('disconnect', () => {
        teacherSocket = null;
      });
    } else if (role === 'student') {
      // if joining mid-poll, send current poll
      if (pollData) {
        socket.emit('pollStarted', pollData);
      }
      // handle student vote
      socket.on('submitVote', (optionIndex) => {
        if (!pollData) {
          socket.emit('voteRejected', 'No active poll');
          return;
        }
        const sid = studentId;
        if (!sid) {
          socket.emit('voteRejected', 'Missing student ID');
          return;
        }
        if (responses[sid] !== undefined) {
          socket.emit('voteRejected', 'Already voted');
          return;
        }
        const idx = parseInt(optionIndex, 10);
        if (isNaN(idx) || idx < 0 || idx >= pollData.options.length) {
          socket.emit('voteRejected', 'Invalid option');
          return;
        }
        responses[sid] = { optionIndex: idx, name };
        socket.emit('voteReceived');
        if (teacherSocket) {
          teacherSocket.emit('studentVoted', { studentId: sid, name, optionIndex: idx });
        }
      });
    }
  });

  function computeStats() {
    const counts = {};
    if (!pollData) return counts;
    pollData.options.forEach((_, i) => { counts[i] = 0; });
    Object.values(responses).forEach(r => {
      if (counts[r.optionIndex] !== undefined) {
        counts[r.optionIndex]++;
      }
    });
    return counts;
  }
};