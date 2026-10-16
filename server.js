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
  road_level_cm: { type: Number, default: null },
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

    const item = await Whitelist.findOneAndUpdate(
      { device_id },
      { $set: { description: description || `โหนด ${device_id}`, added_at: new Date() } },
      { upsert: true, new: true }
    );

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
      critical_threshold_cm,
      road_level_cm
    } = req.body;

    if (!device_id || !device_id.trim()) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();

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
      critical_threshold_cm: critical_threshold_cm !== undefined && critical_threshold_cm !== '' ? Number(critical_threshold_cm) : 50.0,
      road_level_cm: (road_level_cm !== undefined && road_level_cm !== '') ? Number(road_level_cm) : null
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
// 5. API Telemetry (ตัด Duplicate Check ออกแล้ว)
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

    // ตรวจสอบ Whitelist: หากไม่อยู่ในรายการให้ปฏิเสธทันที
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

    // ดึง Config อุปกรณ์เพื่อคำนวณระดับน้ำ
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

    // คำนวณความสูงน้ำจริง
    let calculatedDepth = 0;
    const rawDist = Number(distance_cm);
    if (rawDist > 0) {
      const baseHeight = config.tank_height_cm || 83.0;
      const offset = config.sensor_offset_cm || 0.0;
      calculatedDepth = Math.max(0, Math.round(((baseHeight + offset) - rawDist) * 10) / 10);
    }

    // บันทึกลง Telemetry ทันที ไม่ดัก Packet ซ้ำ
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
    const devId = req.params.deviceId.trim().toUpperCase();
    const { timeframe = '6h' } = req.query;

    const query = { device_id: devId };
    const now = Date.now();

    if (timeframe === '1h') query.created_at = { $gte: new Date(now - 1 * 60 * 60 * 1000) };
    else if (timeframe === '6h') query.created_at = { $gte: new Date(now - 6 * 60 * 60 * 1000) };
    else if (timeframe === '24h') query.created_at = { $gte: new Date(now - 24 * 60 * 60 * 1000) };
    else if (timeframe === '7d') query.created_at = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
    else if (timeframe === '30d') query.created_at = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };

    // 1. ดึงเฉพาะฟิลด์ที่ต้องใช้ในหน้า history
    // 2. ใช้ .lean() เพื่อไม่ให้ Mongoose แปลงเป็น Document Object หนักๆ
    const logs = await Telemetry.find(query)
      .select('created_at water_depth_cm distance_cm battery_percent battery_voltage signal hops_path packet_id')
      .sort({ created_at: 1 })
      .lean();

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 6. Rate Limiter Middleware (1 คำขอ / 5 วินาที ต่อ IP)
// ----------------------------------------------------
const apiRateLimitMap = new Map();
const publicApiLimiter = (req, res, next) => {
  // ดึง IP ของผู้เรียก (รองรับทั้งผ่าน Cloudflare Tunnel, Nginx Proxy และ Docker)
  const clientIp = req.headers['cf-connecting-ip'] 
    || req.headers['x-forwarded-for']?.split(',')[0].trim() 
    || req.socket.remoteAddress;

  const now = Date.now();
  const limitWindowMs = 5000; // 5 วินาที

  if (apiRateLimitMap.has(clientIp)) {
    const lastReqTime = apiRateLimitMap.get(clientIp);
    const timePassed = now - lastReqTime;

    if (timePassed < limitWindowMs) {
      const waitTimeSec = Math.ceil((limitWindowMs - timePassed) / 1000);
      return res.status(429).json({
        success: false,
        error: `Too Many Requests: คำขอถี่เกินไป กรุณารอ ${waitTimeSec} วินาที (Rate limit: 1 ครั้งต่อ 5 วินาที)`
      });
    }
  }

  apiRateLimitMap.set(clientIp, now);
  next();
};

// เคลียร์หน่วยความจำ IP เก่าทุก 1 นาที เพื่อไม่ให้กิน RAM
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of apiRateLimitMap.entries()) {
    if (now - timestamp > 15000) {
      apiRateLimitMap.delete(ip);
    }
  }
}, 60000);

// ----------------------------------------------------
// 7. Public API Endpoints สำหรับระบบภายนอก & Home Assistant
// ----------------------------------------------------

// Endpoint 1: ดึงข้อมูลล่าสุดของ "ทุกจุดวัด"
app.get('/api/v1/water-levels', publicApiLimiter, async (req, res) => {
  try {
    const devices = await DeviceConfig.find().lean();
    const result = await Promise.all(devices.map(async (dev) => {
      const latest = await Telemetry.findOne({ device_id: dev.device_id })
        .sort({ created_at: -1 })
        .lean();

      const waterDepth = (latest && latest.water_depth_cm !== null) ? Number(latest.water_depth_cm) : null;
      const groundLevel = (dev.road_level_cm !== null && dev.road_level_cm !== undefined) ? Number(dev.road_level_cm) : null;

      let remainingToGround = null;
      if (groundLevel !== null && waterDepth !== null) {
        remainingToGround = Math.round((groundLevel - waterDepth) * 10) / 10;
      }

      return {
        device_id: dev.device_id,
        device_name: dev.device_name || `จุดวัด ${dev.device_id}`,
        location_type: dev.location_type || 'ถนน',
        coordinates: {
          latitude: dev.latitude,
          longitude: dev.longitude
        },
        water_depth_cm: waterDepth,
        ground_level_cm: groundLevel,
        remaining_to_ground_cm: remainingToGround,
        raw_distance_cm: latest?.distance_cm ?? null,
        battery_percent: latest?.battery_percent ?? null,
        battery_voltage: latest?.battery_voltage ?? null,
        signal: {
          rssi: latest?.signal?.rssi ?? null,
          snr: latest?.signal?.snr ?? null
        },
        mesh_path: latest?.hops_path || 'DIRECT',
        last_updated: latest?.created_at || null
      };
    }));

    res.json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 2: ดึงข้อมูลล่าสุดของ "จุดวัดเฉพาะโหนด" (แนะนำสำหรับ Home Assistant)
app.get('/api/v1/water-levels/:deviceId', publicApiLimiter, async (req, res) => {
  try {
    const devId = req.params.deviceId.trim().toUpperCase();
    const dev = await DeviceConfig.findOne({ device_id: devId }).lean();

    if (!dev) {
      return res.status(404).json({ success: false, error: `ไม่พบอุปกรณ์ ${devId} ในระบบ` });
    }

    const latest = await Telemetry.findOne({ device_id: devId })
      .sort({ created_at: -1 })
      .lean();

    const waterDepth = (latest && latest.water_depth_cm !== null) ? Number(latest.water_depth_cm) : null;
    const groundLevel = (dev.road_level_cm !== null && dev.road_level_cm !== undefined) ? Number(dev.road_level_cm) : null;

    let remainingToGround = null;
    if (groundLevel !== null && waterDepth !== null) {
      remainingToGround = Math.round((groundLevel - waterDepth) * 10) / 10;
    }

    res.json({
      success: true,
      device_id: dev.device_id,
      device_name: dev.device_name || `จุดวัด ${dev.device_id}`,
      location_type: dev.location_type || 'ถนน',
      coordinates: {
        latitude: dev.latitude,
        longitude: dev.longitude
      },
      water_depth_cm: waterDepth,
      ground_level_cm: groundLevel,
      remaining_to_ground_cm: remainingToGround,
      raw_distance_cm: latest?.distance_cm ?? null,
      battery_percent: latest?.battery_percent ?? null,
      battery_voltage: latest?.battery_voltage ?? null,
      signal: {
        rssi: latest?.signal?.rssi ?? null,
        snr: latest?.signal?.snr ?? null
      },
      mesh_path: latest?.hops_path || 'DIRECT',
      last_updated: latest?.created_at || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 3: ดึงข้อมูลย้อนหลังของจุดวัด (รองรับเลือกช่วงเวลา หรือดึงทั้งหมดแบบจำกัด limit)
app.get('/api/v1/water-levels/:deviceId/history', publicApiLimiter, async (req, res) => {
  try {
    const devId = req.params.deviceId.trim().toUpperCase();
    const { timeframe = '24h', limit = 500 } = req.query;

    // ตรวจสอบว่ามีอุปกรณ์นี้จริงไหม
    const dev = await DeviceConfig.findOne({ device_id: devId }).lean();
    if (!dev) {
      return res.status(404).json({ success: false, error: `ไม่พบอุปกรณ์ ${devId} ในระบบ` });
    }

    // กำหนดเงื่อนไขเวลา
    const query = { device_id: devId };
    const now = Date.now();

    if (timeframe === '1h') query.created_at = { $gte: new Date(now - 1 * 60 * 60 * 1000) };
    else if (timeframe === '6h') query.created_at = { $gte: new Date(now - 6 * 60 * 60 * 1000) };
    else if (timeframe === '24h') query.created_at = { $gte: new Date(now - 24 * 60 * 60 * 1000) };
    else if (timeframe === '7d') query.created_at = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
    else if (timeframe === '30d') query.created_at = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
    // ถ้า timeframe === 'all' จะไม่ใส่เงื่อนไขเวลา คือดึงตั้งแต่เรคคอร์ดแรก

    // จำกัดจำนวนเพื่อความปลอดภัยของ Server (สูงสุดไม่เกิน 2,000 จุดต่อคำขอ)
    const maxLimit = Math.min(Math.max(1, Number(limit) || 500), 2000);

    const historyLogs = await Telemetry.find(query)
      .sort({ created_at: -1 }) // ดึงข้อมูลล่าสุดลงไป
      .limit(maxLimit)
      .lean();

    const groundLevel = (dev.road_level_cm !== null && dev.road_level_cm !== undefined) ? Number(dev.road_level_cm) : null;

    const formattedData = historyLogs.map(log => {
      const waterDepth = log.water_depth_cm !== null ? Number(log.water_depth_cm) : null;
      let remainingToGround = null;
      if (groundLevel !== null && waterDepth !== null) {
        remainingToGround = Math.round((groundLevel - waterDepth) * 10) / 10;
      }

      return {
        timestamp: log.created_at,
        packet_id: log.packet_id ?? null,
        water_depth_cm: waterDepth,
        remaining_to_ground_cm: remainingToGround,
        raw_distance_cm: log.distance_cm ?? null,
        battery_percent: log.battery_percent ?? null,
        battery_voltage: log.battery_voltage ?? null,
        rssi: log.signal?.rssi ?? null,
        snr: log.signal?.snr ?? null,
        mesh_path: log.hops_path || 'DIRECT'
      };
    });

    res.json({
      success: true,
      device_id: devId,
      timeframe: timeframe,
      count: formattedData.length,
      data: formattedData
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LoRa Water Flood System running on port ${PORT}`);
});