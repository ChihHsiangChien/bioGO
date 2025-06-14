const io = require('socket.io-client');
const url = 'http://localhost:3000';
let count = 0;
function checkDone() {
  if (count === 2) process.exit(0);
}
// Default namespace student
const studentDefault = io(url, { query: { role: 'student', studentId: 's1', name: 'Alice' } });
studentDefault.on('disconnect', () => { console.log('studentDefault disconnected'); count++; checkDone(); });
studentDefault.on('forcedDisconnect', (msg) => { console.log('studentDefault forcedDisconnect:', msg); });
// Commons namespace student
const studentCommons = io(url + '/commons', { query: { role: 'student', studentId: 's1', name: 'Alice' } });
studentCommons.on('disconnect', () => { console.log('studentCommons disconnected'); count++; checkDone(); });
studentCommons.on('forcedDisconnect', (msg) => { console.log('studentCommons forcedDisconnect:', msg); });
// Teacher
const teacher = io(url, { query: { role: 'teacher' } });
teacher.on('connect', () => {
  console.log('Teacher connected, will clear in 1s');
  setTimeout(() => {
    console.log('Teacher issuing clearAllStudents');
    teacher.emit('clearAllStudents');
  }, 1000);
});
