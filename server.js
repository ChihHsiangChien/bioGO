const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { generateDataURL } = require('./utils/qrcode-generator');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/activities', express.static(path.join(__dirname, 'activities')));

app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }
  try {
    const dataUrl = await generateDataURL(text);
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Default namespace for login and dashboard
// default namespace state
const students = {}; // socket.id -> { studentId, name }
let teacherSocket = null;
let currentActivity = null;

io.on('connection', (socket) => {
  const { role, studentId, name } = socket.handshake.query;
  if (role === 'student') {
    // track student and acknowledge login
    students[socket.id] = { studentId, name };
    socket.emit('loginSuccess', { studentId, name });
    // if an activity is already launched, notify new student to join
    if (currentActivity) {
      socket.emit('activityLaunched', { activity: currentActivity });
    }
    // update teacher about student list
    if (teacherSocket) {
      teacherSocket.emit('updateStudentList', Object.values(students));
    }
    socket.on('disconnect', () => {
      delete students[socket.id];
      if (teacherSocket) {
        teacherSocket.emit('updateStudentList', Object.values(students));
      }
    });
  } else if (role === 'teacher') {
    // default namespace teacher (dashboard)
    teacherSocket = socket;
    socket.emit('updateStudentList', Object.values(students));
    // teacher launches an activity
    socket.on('launchActivity', (activity) => {
      currentActivity = activity;
      socket.broadcast.emit('activityLaunched', { activity });
    });
    // teacher ends the current activity
    socket.on('endActivity', () => {
      currentActivity = null;
      socket.broadcast.emit('activityEnded');
    });
    socket.on('disconnect', () => {
      teacherSocket = null;
    });
  }
});

// 動態載入所有活動插件 (dynamic activity plugins)
const activitiesDir = path.join(__dirname, 'activities');
const activityList = [];
fs.readdirSync(activitiesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .forEach(dirent => {
    const name = dirent.name;
    const logicPath = path.join(activitiesDir, name, 'logic.js');
    if (fs.existsSync(logicPath)) {
      const nsp = io.of(`/${name}`);
      require(path.join(activitiesDir, name, 'logic'))(nsp);
      activityList.push(name);
    }
  });

// API: 列出所有可用的活動插件
app.get('/api/activities', (req, res) => {
  res.json({ activities: activityList });
});
// API: 取得指定活動的測驗集 (sets)
app.get('/api/activities/:activity/sets', (req, res) => {
  const activity = req.params.activity;
  const dir = path.join(activitiesDir, activity);
  if (!fs.existsSync(dir)) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const sets = files
      .filter(f => f.isFile() && f.name.endsWith('.json') && f.name !== 'questions.json')
      .map(f => path.basename(f.name, '.json'));
    res.json({ sets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});