const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5002;

// โฟลเดอร์อัปโหลดภาพ
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'device-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------
// 1. เชื่อมต่อ MongoDB
// ------------------------------------------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lora_flood_db';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected successfully.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ------------------------------------------
// 2. Mongoose Models
// ------------------------------------------

// ตาราง Whitelist สำหรับอนุญาตอุปกรณ์
const WhitelistSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true, uppercase: true, trim: true },
  description: { type: String, default: '' },
  added_at: { type: Date, default: Date.now }
});

const DeviceConfigSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true, index: true },
  device_name: { type: String, default: '' },
  location_type: { type: String, default: 'ถนน' },
  latitude: { type: Number, default: 13.606 },
  longitude: { type: Number, default: 100.702 },
  tank_height_cm: { type: Number, default: 83.0 },
  sensor_offset_cm: { type: Number, default: 0.0 },
  warning_threshold_cm: { type: Number, default: 25.0 },
  critical_threshold_cm: { type: Number, default: 50.0 },
  image_url: { type: String, default: '' }
}, { timestamps: true });

const TelemetrySchema = new mongoose.Schema({
  device_id: { type: String, required: true, index: true },
  gateway_id: { type: String, default: 'GW-001' },
  packet_id: { type: Number },
  hops_path: { type: String, default: 'DIRECT' },
  distance_cm: { type: Number, required: true },
  water_depth_cm: { type: Number },
  battery_voltage: { type: Number },
  battery_percent: { type: Number },
  status: { type: String, default: 'OK' },
  signal: {
    rssi: { type: Number },
    snr: { type: Number }
  },
  created_at: { type: Date, default: Date.now, index: true }
});

const Whitelist = mongoose.model('Whitelist', WhitelistSchema);
const DeviceConfig = mongoose.model('DeviceConfig', DeviceConfigSchema);
const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// ------------------------------------------
// 3. API Routes: Whitelist
// ------------------------------------------

// ดึงรายการ Whitelist ทั้งหมด
app.get('/api/whitelist', async (req, res) => {
  try {
    const list = await Whitelist.find().sort({ added_at: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เพิ่ม Device ID เข้า Whitelist
app.post('/api/whitelist', async (req, res) => {
  try {
    let { device_id, description } = req.body;
    if (!device_id || !device_id.trim()) {
      return res.status(400).json({ error: 'device_id is required' });
    }
    device_id = device_id.trim().toUpperCase();

    // บันทึกลง Whitelist
    const item = await Whitelist.findOneAndUpdate(
      { device_id },
      { $set: { description: description || `โหนด ${device_id}`, added_at: new Date() } },
      { upsert: true, new: true }
    );

    // สร้าง DeviceConfig ตั้งต้นควบคู่กันไว้
    await DeviceConfig.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: {
          device_name: `จุดวัด ${device_id}`,
          location_type: 'ถนน',
          tank_height_cm: 83.0,
          warning_threshold_cm: 25.0,
          critical_threshold_cm: 50.0
        }
      },
      { upsert: true }
    );

    res.json({ success: true, message: `เพิ่ม ${device_id} เข้า Whitelist สำเร็จ`, data: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ลบ Device ID ออกจาก Whitelist
app.delete('/api/whitelist/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId.trim().toUpperCase();
    await Whitelist.deleteOne({ device_id: deviceId });
    res.json({ success: true, message: `ลบ ${deviceId} ออกจาก Whitelist สำเร็จ` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// 4. API Routes: Config & Devices (Admin)
// ------------------------------------------

// บันทึก / อัปเดตการตั้งค่าจุดวัด
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

    if (!device_id || !device_id.trim()) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();

    // เพิ่มเข้า Whitelist อัตโนมัติเมื่อมีการบันทึกจากหน้า Admin
    await Whitelist.findOneAndUpdate(
      { device_id: cleanDeviceId },
      { $setOnInsert: { description: device_name || cleanDeviceId } },
      { upsert: true }
    );

    const updateData = {
      device_name: device_name ? device_name.trim() : `จุดวัด ${cleanDeviceId}`,
      location_type: location_type || 'ถนน',
      latitude: latitude !== undefined && latitude !== '' ? Number(latitude) : 13.606,
      longitude: longitude !== undefined && longitude !== '' ? Number(longitude) : 100.702,
      tank_height_cm: tank_height_cm !== undefined && tank_height_cm !== '' ? Number(tank_height_cm) : 83.0,
      sensor_offset_cm: sensor_offset_cm !== undefined && sensor_offset_cm !== '' ? Number(sensor_offset_cm) : 0.0,
      warning_threshold_cm: warning_threshold_cm !== undefined && warning_threshold_cm !== '' ? Number(warning_threshold_cm) : 25.0,
      critical_threshold_cm: critical_threshold_cm !== undefined && critical_threshold_cm !== '' ? Number(critical_threshold_cm) : 50.0
    };

    if (req.file) {
      updateData.image_url = `/uploads/${req.file.filename}`;
    }

    const updatedConfig = await DeviceConfig.findOneAndUpdate(
      { device_id: cleanDeviceId },
      { $set: updateData },
      { new: true, upsert: true }
    );

    res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ', data: updatedConfig });
  } catch (err) {
    console.error('Config Save Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ฟังก์ชันลบอุปกรณ์และประวัติทั้งหมด
const deleteDeviceHandler = async (req, res) => {
  try {
    const deviceId = req.params.deviceId.trim().toUpperCase();
    await Whitelist.deleteOne({ device_id: deviceId });
    await DeviceConfig.deleteOne({ device_id: deviceId });
    await Telemetry.deleteMany({ device_id: deviceId });

    res.json({ success: true, message: `ลบอุปกรณ์ ${deviceId} ออกจากระบบเรียบร้อยแล้ว` });
  } catch (err) {
    console.error('Delete Device Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// รองรับทั้ง /api/devices/:deviceId และ /api/config/:deviceId ป้องกัน 404
app.delete('/api/devices/:deviceId', deleteDeviceHandler);
app.delete('/api/config/:deviceId', deleteDeviceHandler);

app.get('/api/devices', async (req, res) => {
  try {
    const devices = await DeviceConfig.find().lean();
    const result = await Promise.all(devices.map(async (dev) => {
      const latest = await Telemetry.findOne({ device_id: dev.device_id })
        .sort({ created_at: -1 })
        .lean();
      return {
        ...dev,
        latest_telemetry: latest || null
      };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId.trim().toUpperCase();
    const config = await DeviceConfig.findOne({ device_id: deviceId });
    if (!config) return res.status(404).json({ error: 'Device not found' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId.trim().toUpperCase();
    const config = await DeviceConfig.findOne({ device_id: deviceId });
    if (!config) return res.status(404).json({ error: 'Device not found' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// 5. API Telemetry (ระบบตรวจ Whitelist เข้มงวด)
// ------------------------------------------
app.post('/api/telemetry', async (req, res) => {
  try {
    let { 
      device_id, 
      gateway_id, 
      packet_id, 
      hops_path, 
      distance_cm, 
      battery_voltage, 
      battery_percent, 
      status, 
      rssi, 
      snr 
    } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();

    // 1. ตรวจสอบ Whitelist: หากไม่อยู่ในรายการ ให้ทิ้งทันที
    const isAllowed = await Whitelist.exists({ device_id: cleanDeviceId });
    if (!isAllowed) {
      console.warn(`[BLOCKED] Device "${cleanDeviceId}" is NOT in Whitelist. Packet dropped.`);
      return res.status(403).json({
        success: false,
        message: `Device ${cleanDeviceId} is not in whitelist. Telemetry rejected.`
      });
    }

    if (distance_cm === undefined || isNaN(distance_cm)) {
      return res.status(400).json({ error: 'Valid distance_cm is required' });
    }

    // 2. กรองข้อมูลซ้ำใน 60 วินาที
    if (packet_id !== undefined && packet_id !== null) {
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const duplicate = await Telemetry.findOne({
        device_id: cleanDeviceId,
        packet_id: Number(packet_id),
        created_at: { $gte: oneMinuteAgo }
      });

      if (duplicate) {
        return res.status(200).json({ 
          success: true, 
          message: 'Duplicate packet ignored', 
          telemetry_id: duplicate._id 
        });
      }
    }

    // 3. ดึง Config
    let config = await DeviceConfig.findOne({ device_id: cleanDeviceId });
    if (!config) {
      config = await DeviceConfig.create({
        device_id: cleanDeviceId,
        device_name: `จุดวัด ${cleanDeviceId}`,
        tank_height_cm: 83.0,
        warning_threshold_cm: 25.0,
        critical_threshold_cm: 50.0
      });
    }

    // 4. คำนวณความสูงน้ำ
    let calculatedDepth = 0;
    const rawDist = Number(distance_cm);
    if (rawDist > 0) {
      const baseHeight = config.tank_height_cm || 83.0;
      const offset = config.sensor_offset_cm || 0.0;
      calculatedDepth = Math.max(0, Math.round(((baseHeight + offset) - rawDist) * 10) / 10);
    }

    const telemetry = new Telemetry({
      device_id: cleanDeviceId,
      gateway_id: gateway_id || 'GW-001',
      packet_id: packet_id !== undefined ? Number(packet_id) : undefined,
      hops_path: hops_path || cleanDeviceId,
      distance_cm: rawDist,
      water_depth_cm: rawDist > 0 ? calculatedDepth : null,
      battery_voltage: battery_voltage ? Number(battery_voltage) : undefined,
      battery_percent: battery_percent ? Number(battery_percent) : undefined,
      status: status || 'OK',
      signal: {
        rssi: rssi ? Number(rssi) : undefined,
        snr: snr ? Number(snr) : undefined
      },
      created_at: new Date()
    });

    await telemetry.save();

    res.status(201).json({ success: true, message: 'Telemetry saved', data: telemetry });
  } catch (err) {
    console.error('Telemetry Save Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ดึงข้อมูลประวัติ
app.get('/api/telemetry/history/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId.trim().toUpperCase();
    const { timeframe } = req.query;

    let timeLimit = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (timeframe === '1h') timeLimit = new Date(Date.now() - 60 * 60 * 1000);
    else if (timeframe === '6h') timeLimit = new Date(Date.now() - 6 * 60 * 60 * 1000);
    else if (timeframe === '7d') timeLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (timeframe === '30d') timeLimit = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const history = await Telemetry.find({
      device_id: deviceId,
      created_at: { $gte: timeLimit }
    }).sort({ created_at: 1 }).lean();

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LoRa Water Flood System running on port ${PORT}`);
});