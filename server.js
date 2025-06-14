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
const studentSessions = {}; // studentId -> { name }
// helper to send unique student list to teacherSocket
function sendStudentList(sock) {
  const unique = Object.entries(studentSessions).map(([studentId, info]) => ({ studentId, name: info.name }));
  sock.emit('updateStudentList', unique);
}
let teacherSocket = null;
let currentActivity = null;

io.on('connection', (socket) => {
  const { role, studentId, name } = socket.handshake.query;
  if (role === 'student') {
    // prevent duplicate names (unless reconnecting same studentId)
    if (Object.values(students).some(s => s.name === name && s.studentId !== studentId)) {
      socket.emit('loginRejected', '此名稱已被使用，請使用其他名稱');
      return socket.disconnect(true);
    }
    // track student and acknowledge login
    students[socket.id] = { studentId, name };
    studentSessions[studentId] = { name };
    socket.emit('loginSuccess', { studentId, name });
    // if an activity is already launched, notify new student to join
    if (currentActivity) {
      socket.emit('activityLaunched', { activity: currentActivity });
    }
    // update teacher about student list
    if (teacherSocket) {
      sendStudentList(teacherSocket);
    }
    socket.on('disconnect', () => {
      delete students[socket.id];
      if (teacherSocket) {
        sendStudentList(teacherSocket);
      }
    });
  } else if (role === 'teacher') {
    // default namespace teacher (dashboard)
    teacherSocket = socket;
    sendStudentList(socket);
    // teacher launches an activity
    socket.on('launchActivity', (activity) => {
      currentActivity = activity;
      socket.broadcast.emit('activityLaunched', { activity });
    });
    // teacher removes a student (force re-login)
    socket.on('removeStudent', (targetStudentId) => {
      // find and disconnect matching student sockets
      Object.entries(students).forEach(([sid, info]) => {
        if (info.studentId === targetStudentId) {
          const s = io.sockets.sockets.get(sid);
          if (s) {
            s.emit('forcedDisconnect', '已被教師移除，請重新登入');
            s.disconnect(true);
          }
          delete students[sid];
        }
      });
      // clear persistent session (login records)
      delete studentSessions[targetStudentId];
      // also disconnect matching student sockets in Commons namespace
      const commonsNs = io.of('/commons');
      commonsNs.sockets.forEach(s => {
        if (s.handshake.query.role === 'student' && s.handshake.query.studentId === targetStudentId) {
          s.emit('forcedDisconnect', '已被教師移除，請重新登入');
          s.disconnect(true);
        }
      });
      // update teacher view
      sendStudentList(socket);
    });
    // teacher clears all student sessions and disconnects
    socket.on('clearAllStudents', () => {
      // disconnect all student sockets
      Object.keys(students).forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit('forcedDisconnect', '教師已清除所有學生，請重新登入');
          s.disconnect(true);
        }
      });
      // clear all student sockets and sessions
      Object.keys(students).forEach(sid => delete students[sid]);
      Object.keys(studentSessions).forEach(id => delete studentSessions[id]);
      // also disconnect all student sockets in Commons namespace
      const commonsNsAll = io.of('/commons');
      commonsNsAll.sockets.forEach(s => {
        if (s.handshake.query.role === 'student') {
          s.emit('forcedDisconnect', '教師已清除所有學生，請重新登入');
          s.disconnect(true);
        }
      });
      sendStudentList(socket);
    });
    // teacher ends the current activity
    socket.on('endActivity', () => {
      currentActivity = null;
      // notify students in default namespace
      socket.broadcast.emit('activityEnded');
      // refresh teacher student list
      sendStudentList(socket);
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

const os = require('os');
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Handle listen errors (e.g., port in use) gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} 已被佔用，請先關閉舊程式，或設定環境變數 PORT 指定其他埠號`);
    process.exit(1);
  } else {
    console.error(err);
    process.exit(1);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // Print accessible URLs
  console.log('Teacher dashboard URLs:');
  // Localhost
  //console.log(`  http://localhost:${PORT}/teacher`);
  // Network interfaces

  
  const nets = os.networkInterfaces();
  // console.log('DEBUG 所有網卡:');
  // console.log(nets);
  
  function isPrivateIP(ip) {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') && (() => {
        const second = parseInt(ip.split('.')[1], 10);
        return second >= 16 && second <= 31;
      })())
    );
  }
  
  Object.entries(nets).forEach(([name, ifaces]) => {
    // 過濾掉不想要的介面卡（例如 WSL）
    const lname = name.toLowerCase();
    const isLikelyReal =
      lname.includes('wi-fi') || lname.includes('wlan') || lname.includes('ethernet') || lname.startsWith('en') || lname.startsWith('wl');
    if (!isLikelyReal) return;
  
    ifaces.forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal && isPrivateIP(iface.address)) {
        console.log(`  http://${iface.address}:${PORT}/teacher`);
        console.log(`  http://${iface.address}:${PORT}/student`);
      }
    });
  });

});