// ===== Web API Service (ส่วนให้บริการเว็บ) =====
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';

// --- Database Config ---
const mongoUri = `mongodb://root:examplepassword@mongo:27019/?authSource=admin`;
const dbName = 'waterSystemDB';
const client = new MongoClient(mongoUri);
let db;

// --- Express App Config ---
const app = express();
const port = 3000;
const SESSION_SECRET = 'your-super-secret-key-please-change-this!'; 

// --- Multer Config ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const sensorId = req.body.sensorId || 'unknown';
    const uniqueSuffix = Date.now() + path.extname(file.originalname);
    cb(null, `${sensorId}-${uniqueSuffix}`);
  }
});

const upload = multer({ storage: storage });

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false, 
    saveUninitialized: false, 
    store: MongoStore.create({
      mongoUrl: mongoUri, 
      dbName: dbName,
      collectionName: 'sessions', 
      ttl: 14 * 24 * 60 * 60 
    }),
    cookie: {
      maxAge: 14 * 24 * 60 * 60 * 1000, 
      httpOnly: true, 
      secure: false 
    }
  })
);

const checkAuth = (req, res, next) => {
  if (req.session.isLoggedIn) {
    next();
  } else {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.status(401).json({ message: 'Unauthorized: Please log in.' });
    } else {
      res.redirect('/login.html');
    }
  }
};

async function calculateSensorStatus(sensorConfig, lastReading) {
  let status = 'Offline';
  let currentLevel = null;
  let lastUpdateISO = null;

  if (lastReading) {
    const offset = sensorConfig.calibrationOffset || 0;
    const waterLevel_cm = offset - lastReading.rawValue;
    currentLevel = waterLevel_cm / 100.0;
    if (currentLevel < 0) currentLevel = 0;

    const watch = sensorConfig.thresholds.watch || 0.4;
    const critical = sensorConfig.thresholds.critical || 0.8;

    if (currentLevel >= critical) {
      status = 'วิกฤต';
    } else if (currentLevel >= watch) {
      status = 'เฝ้าระวัง';
    } else {
      status = 'ปกติ';
    }
    lastUpdateISO = lastReading.timestamp;
  } else if (sensorConfig.lastUpdateISO) {
    lastUpdateISO = sensorConfig.lastUpdateISO;
  }
  
  return { status, currentLevel, lastUpdateISO };
}

// ===== API สำหรับ Login / Logout =====
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'กรุณากรอกอีเมลและรหัสผ่าน' });
    }

    const user = await db.collection('users').findOne({ email: email });
    if (!user) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    req.session.isLoggedIn = true;
    req.session.userId = user._id;
    req.session.email = user.email;

    console.log(`[Web API] User login successful: ${user.email}`);
    res.json({ message: 'ล็อกอินสำเร็จ' });

  } catch (err) {
    console.error("[Web API] Error in /api/login:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: 'ไม่สามารถออกจากระบบได้' });
    res.clearCookie('connect.sid'); 
    res.json({ message: 'ออกจากระบบสำเร็จ' });
  });
});

app.get('/api/me', checkAuth, (req, res) => {
  res.json({ isLoggedIn: true, email: req.session.email });
});

// ===== API Endpoints =====
app.get('/api/sensors', async (req, res) => {
  try {
    const sensors = await db.collection('sensors').find().toArray();
    const sensorDataWithStatus = await Promise.all(
      sensors.map(async (sensor) => {
        const lastReading = await db.collection('readings')
          .find({ sensorId: sensor.sensorId }).sort({ timestamp: -1 }).limit(1).toArray();
        const { status, currentLevel, lastUpdateISO } = await calculateSensorStatus(sensor, lastReading[0]);
        const lastUpdate = lastUpdateISO 
          ? new Date(lastUpdateISO).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) 
          : 'N/A';
        return { ...sensor, status, currentLevel, lastUpdate, lastUpdateISO };
      })
    );
    res.json(sensorDataWithStatus);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get('/api/sensors/config', checkAuth, async (req, res) => {
  try {
    const sensors = await db.collection('sensors').find().toArray();
    const sensorConfigsWithLatestReading = await Promise.all(
      sensors.map(async (sensor) => {
        const lastReading = await db.collection('readings')
          .find({ sensorId: sensor.sensorId }).sort({ timestamp: -1 }).limit(1).toArray();
        return { ...sensor, lastRawValue: lastReading.length > 0 ? lastReading[0].rawValue : null };
      })
    );
    res.json(sensorConfigsWithLatestReading);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/sensors/config', checkAuth, upload.single('imageFile'), async (req, res) => {
  try {
    const { sensorId, name, location, type, calibrationOffset, thresholdWatch, thresholdCritical, existingImageUrl } = req.body;
    const filter = { sensorId: sensorId };
    const dataToUpdate = {
      name, location, type,
      calibrationOffset: parseFloat(calibrationOffset) || 0,
      thresholds: { watch: parseFloat(thresholdWatch) || 0.4, critical: parseFloat(thresholdCritical) || 0.8 },
      imageUrl: existingImageUrl
    };

    if (req.file) {
      dataToUpdate.imageUrl = `/uploads/${req.file.filename}`;
      if (existingImageUrl && !existingImageUrl.startsWith('http')) {
        const oldImagePath = path.join(__dirname, 'public', existingImageUrl);
        if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
      }
    }

    const result = await db.collection('sensors').updateOne(filter, { $set: dataToUpdate }, { upsert: true });
    res.json({ message: "บันทึกข้อมูลสำเร็จ", data: result });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการบันทึก" });
  }
});

app.get('/api/sensor/config/:id', async (req, res) => {
  try {
    const sensorId = req.params.id;
    const sensorConfig = await db.collection('sensors').findOne({ sensorId: sensorId });
    if (!sensorConfig) return res.status(404).json({ message: "ไม่พบเซ็นเซอร์" });

    const lastReading = await db.collection('readings')
      .find({ sensorId: sensorId }).sort({ timestamp: -1 }).limit(1).toArray();
    const { status, currentLevel, lastUpdateISO } = await calculateSensorStatus(sensorConfig, lastReading[0]);

    res.json({ ...sensorConfig, status, currentLevel, lastUpdateISO });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/api/sensor/readings/:id', async (req, res) => {
  try {
    const sensorId = req.params.id;
    const range = req.query.range;
    const specificDate = req.query.date; 

    let filter = { sensorId: sensorId };

    if (specificDate) {
      const startOfDay = new Date(`${specificDate}T00:00:00+07:00`);
      const endOfDay = new Date(`${specificDate}T23:59:59.999+07:00`);
      filter.timestamp = { $gte: startOfDay, $lte: endOfDay };
    } else if (range && range !== 'all') {
      const now = new Date();
      let startTime;
      if (range === '3h') startTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
      else if (range === '24h') startTime = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      else if (range === '7d') startTime = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      else if (range === '30d') startTime = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      if (startTime) filter.timestamp = { $gte: startTime };
    }

    const readings = await db.collection('readings').find(filter).sort({ timestamp: 1 }).toArray();
    res.json(readings);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.delete('/api/sensor/:id', checkAuth, async (req, res) => {
  try {
    const sensorId = req.params.id;
    const sensorConfig = await db.collection('sensors').findOne({ sensorId: sensorId });
    if (sensorConfig && sensorConfig.imageUrl && !sensorConfig.imageUrl.startsWith('http')) {
      const imagePath = path.join(__dirname, 'public', sensorConfig.imageUrl);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
    await db.collection('sensors').deleteOne({ sensorId: sensorId });
    await db.collection('readings').deleteMany({ sensorId: sensorId });
    res.json({ message: "ลบข้อมูลสำเร็จ" });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบ" });
  }
});

// ===== API สำหรับจัดการผู้ใช้ (User Management) =====
app.get('/api/users', checkAuth, async (req, res) => {
  try {
    const users = await db.collection('users').find({}, { projection: { email: 1, createdAt: 1 } }).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/users', checkAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'กรุณากรอกอีเมลและรหัสผ่าน' });
    
    const existingUser = await db.collection('users').findOne({ email: email });
    if (existingUser) return res.status(400).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await db.collection('users').insertOne({ email, password: hashedPassword, createdAt: new Date() });
    res.status(201).json({ message: 'สร้างผู้ใช้ใหม่สำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.delete('/api/users/:id', checkAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.session.userId.toString()) return res.status(400).json({ message: 'คุณไม่สามารถลบ Account ของตัวเองได้' });
    const result = await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'ไม่พบผู้ใช้ที่ต้องการลบ' });
    res.json({ message: 'ลบผู้ใช้สำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ===== การให้บริการไฟล์ Static =====
app.get('/admin.html', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// --- ฟังก์ชันสร้าง Admin เริ่มต้น (เพิ่มใหม่) ---
async function createDefaultAdmin() {
  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    console.log("[Web API] ไม่พบผู้ใช้ในระบบ กำลังสร้าง Admin เริ่มต้น...");
    const defaultEmail = "admin@example.com";
    const defaultPassword = "password123";
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

    await db.collection('users').insertOne({
      email: defaultEmail,
      password: hashedPassword,
      createdAt: new Date()
    });
    
    console.log(`[Web API] สร้าง Admin เริ่มต้นสำเร็จ!`);
    console.log(`[Web API] Email: ${defaultEmail}`);
    console.log(`[Web API] Password: ${defaultPassword}`);
    console.log(`[Web API] (กรุณาล็อกอินและสร้างผู้ใช้ใหม่ จากนั้นลบ User นี้ทิ้งเพื่อความปลอดภัย)`);
  }
}

// --- ฟังก์ชันเชื่อมต่อ Database ---
async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log(`[Web API] Connected successfully to MongoDB`);
    await db.collection('readings').createIndex({ sensorId: 1, timestamp: -1 });
    await db.collection('sensors').createIndex({ sensorId: 1 }, { unique: true });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  } catch (err) {
    console.error("[Web API] Could not connect to MongoDB", err);
    process.exit(1);
  }
}

// --- เริ่มการทำงานของ Server ---
async function startServer() {
  console.log("Starting Web API Service...");
  await connectDB();
  
  // เรียกฟังก์ชันสร้าง Admin เริ่มต้นหลังจากต่อ DB สำเร็จ
  await createDefaultAdmin();
  
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Web API] เซิร์ฟเวอร์กำลังทำงานที่ http://localhost:${port}`);
  });
}

startServer();