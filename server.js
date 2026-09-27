const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:password123@mongodb:27017/water_monitoring?authSource=admin';

// ตรวจสอบและสร้างโฟลเดอร์สำหรับเก็บรูปภาพ
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ตั้งค่าที่จัดเก็บไฟล์รูปภาพด้วย Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'point-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
// --------------------------------------------------
// MongoDB Schemas
// --------------------------------------------------
const DeviceConfigSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true },
  device_name: { type: String, default: 'จุดวัดระดับน้ำ' },
  location_type: { 
    type: String, 
    enum: ['ถนน', 'ท่อน้ำ', 'คลอง'], 
    default: 'ถนน' 
  },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  image_url: { type: String, default: '' },
  tank_height_cm: { type: Number, default: 83.0 },
  sensor_offset_cm: { type: Number, default: 0.0 },
  warning_threshold_cm: { type: Number, default: null }, // เกณฑ์เตือนภัย (cm)
  critical_threshold_cm: { type: Number, default: null }, // เกณฑ์วิกฤต (cm)
  updated_at: { type: Date, default: Date.now }
});

const TelemetrySchema = new mongoose.Schema({
  device_id: { type: String, required: true, index: true },
  gateway_id: { type: String },
  packet_id: { type: Number },
  distance_cm: { type: Number, required: true },
  water_depth_cm: { type: Number, default: null },
  water_percent: { type: Number, default: null },
  battery_voltage: { type: Number },
  battery_percent: { type: Number },
  sensor_status: { type: String, default: 'OK' },
  signal: {
    rssi: { type: Number },
    snr: { type: Number }
  },
  created_at: { type: Date, default: Date.now, index: true }
});

const DeviceConfig = mongoose.model('DeviceConfig', DeviceConfigSchema);
const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// --------------------------------------------------
// API Endpoints
// --------------------------------------------------

// 1. รับข้อมูลจาก Gateway
app.post('/api/telemetry', async (req, res) => {
  try {
    const {
      device_id, gateway_id, packet_id, distance_cm,
      battery_voltage, battery_percent, status, rssi, snr
    } = req.body;

    // กรองขยะ: device_id ต้องเป็น A-Z, 0-9, ขีด (-) เท่านั้น ความยาว 3-12 ตัวอักษร
    const validIdRegex = /^[A-Za-z0-9_-]{3,12}$/;
    if (!device_id || !validIdRegex.test(device_id)) {
      return res.status(400).json({ error: 'Invalid or corrupted device_id' });
    }

    if (!device_id || distance_cm === undefined) {
      return res.status(400).json({ error: 'device_id and distance_cm are required.' });
    }

    let config = await DeviceConfig.findOne({ device_id });
    if (!config) {
      config = await DeviceConfig.create({ device_id, device_name: `โหนด ${device_id}` });
    }

    let waterDepthCm = null;
    let waterPercent = null;

    if (status === 'OK' && distance_cm > 0) {
      const maxDistance = config.tank_height_cm + config.sensor_offset_cm;
      waterDepthCm = maxDistance - distance_cm;
      if (waterDepthCm < 0) waterDepthCm = 0;
      if (waterDepthCm > config.tank_height_cm) waterDepthCm = config.tank_height_cm;

      waterPercent = (waterDepthCm / config.tank_height_cm) * 100.0;
      waterDepthCm = parseFloat(waterDepthCm.toFixed(1));
      waterPercent = parseFloat(waterPercent.toFixed(1));
    }

    const doc = await Telemetry.create({
      device_id,
      gateway_id,
      packet_id,
      distance_cm,
      water_depth_cm: waterDepthCm,
      water_percent: waterPercent,
      battery_voltage,
      battery_percent,
      sensor_status: status || 'OK',
      signal: { rssi, snr }
    });

    res.status(201).json({ success: true, message: 'Telemetry logged successfully', data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ดึงรายการ Device ทั้งหมด
app.get('/api/devices', async (req, res) => {
  try {
    const configs = await DeviceConfig.find().lean();
    const result = await Promise.all(configs.map(async (cfg) => {
      const latest = await Telemetry.findOne({ device_id: cfg.device_id }).sort({ created_at: -1 }).lean();
      return {
        ...cfg,
        latest_telemetry: latest || null
      };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. บันทึก / อัปเดตข้อมูล Config พร้อมรองรับอัปโหลดรูปภาพ
app.post('/api/config', upload.single('image'), async (req, res) => {
  try {
    const { 
      device_id, 
      device_name, 
      location_type, 
      latitude, 
      longitude, 
      tank_height_cm, 
      sensor_offset_cm,
      warning_threshold_cm,
      critical_threshold_cm
    } = req.body;

    const updateData = {
      device_name,
      location_type: location_type || 'ถนน',
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      tank_height_cm: parseFloat(tank_height_cm),
      sensor_offset_cm: parseFloat(sensor_offset_cm),
      warning_threshold_cm: warning_threshold_cm !== '' && warning_threshold_cm !== undefined && warning_threshold_cm !== null ? parseFloat(warning_threshold_cm) : null,
      critical_threshold_cm: critical_threshold_cm !== '' && critical_threshold_cm !== undefined && critical_threshold_cm !== null ? parseFloat(critical_threshold_cm) : null,
      updated_at: new Date()
    };

    if (req.file) {
      updateData.image_url = `/uploads/${req.file.filename}`;
    }

    const config = await DeviceConfig.findOneAndUpdate(
      { device_id },
      updateData,
      { upsert: true, new: true }
    );

    res.json({ success: true, config });
  } catch (err) {
    console.error('Config save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint สำหรับดึงประวัติย้อนหลังตามช่วงเวลา
app.get('/api/telemetry/history/:device_id', async (req, res) => {
  try {
    const { device_id } = req.params;
    const { timeframe = '24h' } = req.query;

    let hoursAgo = 24;
    if (timeframe === '1h') hoursAgo = 1;
    else if (timeframe === '6h') hoursAgo = 6;
    else if (timeframe === '24h') hoursAgo = 24;
    else if (timeframe === '7d') hoursAgo = 24 * 7;
    else if (timeframe === '30d') hoursAgo = 24 * 30;

    const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const logs = await Telemetry.find({
      device_id,
      created_at: { $gte: startTime }
    })
      .sort({ created_at: 1 })
      .lean();

    res.json(logs);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ลบ Device และ Telemetry ของอุปกรณ์นั้น
app.delete('/api/devices/:device_id', async (req, res) => {
  try {
    const { device_id } = req.params;
    await DeviceConfig.deleteOne({ device_id });
    await Telemetry.deleteMany({ device_id });
    res.json({ success: true, message: `Deleted ${device_id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เชื่อมต่อ MongoDB & Run
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB connection error:', err));