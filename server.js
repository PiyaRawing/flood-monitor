const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5002;

// กำหนด Limit สูงขึ้นเพื่อรองรับการส่งรูปภาพ Base64 จากหน้า Admin
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. เชื่อมต่อ MongoDB
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lora_flood_db';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected successfully.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ==========================================
// 2. Mongoose Schemas & Models
// ==========================================
const DeviceConfigSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true, index: true },
  device_name: { type: String, default: '' },
  location_type: { type: String, default: 'ถนน' },
  latitude: { type: Number, default: 13.606 },
  longitude: { type: Number, default: 100.702 },
  tank_height_cm: { type: Number, default: 83.0 },
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

const DeviceConfig = mongoose.model('DeviceConfig', DeviceConfigSchema);
const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// ==========================================
// 3. API Routes: Telemetry
// ==========================================

// รับข้อมูล Telemetry จาก LoRa Gateway
app.post('/api/telemetry', async (req, res) => {
  try {
    const { 
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

    const validIdRegex = /^[A-Za-z0-9_-]{3,16}$/;
    if (!device_id || !validIdRegex.test(device_id)) {
      return res.status(400).json({ error: 'Invalid device_id format' });
    }

    if (distance_cm === undefined || isNaN(distance_cm)) {
      return res.status(400).json({ error: 'Valid distance_cm is required' });
    }

    // Server-side Deduplication: ตรวจสอบแพ็กเก็ตซ้ำในรอบ 60 วินาที
    if (packet_id !== undefined && packet_id !== null) {
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const duplicate = await Telemetry.findOne({
        device_id,
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

    // ค้นหาหรือลงทะเบียน Config อัตโนมัติหากเป็นโหนดใหม่
    let config = await DeviceConfig.findOne({ device_id });
    if (!config) {
      config = await DeviceConfig.create({
        device_id,
        device_name: `จุดวัด ${device_id}`,
        location_type: 'ถนน',
        tank_height_cm: 83.0,
        warning_threshold_cm: 25.0,
        critical_threshold_cm: 50.0
      });
    }

    // คำนวณความสูงน้ำ
    let calculatedDepth = 0;
    const rawDist = Number(distance_cm);
    if (rawDist > 0) {
      const baseHeight = config.tank_height_cm || 83.0;
      calculatedDepth = Math.max(0, Math.round((baseHeight - rawDist) * 10) / 10);
    }

    const telemetry = new Telemetry({
      device_id,
      gateway_id: gateway_id || 'GW-001',
      packet_id: packet_id !== undefined ? Number(packet_id) : undefined,
      hops_path: hops_path || device_id,
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

// ดึงรายการโหนดทั้งหมดพร้อมข้อมูลล่าสุดสำหรับหน้าแรก
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

// ดึงประวัติข้อมูลตามช่วงเวลาสำหรับหน้า History
app.get('/api/telemetry/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { timeframe } = req.query;

    let timeLimit = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 ชม. เริ่มต้น
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

// ==========================================
// 4. API Routes: Config & Admin (แก้ 404)
// ==========================================

// บันทึกหรืออัปเดตการตั้งค่าจุดตรวจวัด (POST /api/config)
app.post('/api/config', async (req, res) => {
  try {
    const {
      device_id,
      device_name,
      location_type,
      latitude,
      longitude,
      tank_height_cm,
      warning_threshold_cm,
      critical_threshold_cm,
      image_url
    } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const updatedConfig = await DeviceConfig.findOneAndUpdate(
      { device_id },
      {
        $set: {
          device_name: device_name || '',
          location_type: location_type || 'ถนน',
          latitude: latitude !== undefined ? Number(latitude) : 13.606,
          longitude: longitude !== undefined ? Number(longitude) : 100.702,
          tank_height_cm: tank_height_cm !== undefined ? Number(tank_height_cm) : 83.0,
          warning_threshold_cm: warning_threshold_cm !== undefined ? Number(warning_threshold_cm) : 25.0,
          critical_threshold_cm: critical_threshold_cm !== undefined ? Number(critical_threshold_cm) : 50.0,
          image_url: image_url || ''
        }
      },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: 'บันทึกการตั้งค่าสำเร็จ',
      data: updatedConfig
    });
  } catch (err) {
    console.error('Config Save Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ดึงข้อมูลการตั้งค่าจุดตรวจวัดรายตัว (GET /api/config/:deviceId)
app.get('/api/config/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const config = await DeviceConfig.findOne({ device_id: deviceId });
    if (!config) {
      return res.status(404).json({ error: 'Device config not found' });
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ลบจุดตรวจวัด (DELETE /api/config/:deviceId)
app.delete('/api/config/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    await DeviceConfig.deleteOne({ device_id: deviceId });
    res.json({ success: true, message: 'ลบจุดตรวจวัดสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. Start Server
// ==========================================
app.listen(PORT, () => {
  console.log(`LoRa Water Flood System running on port ${PORT}`);
});