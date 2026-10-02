const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// เชื่อมต่อ MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lora_flood_db';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected successfully.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ==========================================
// Schemas & Models
// ==========================================
const DeviceConfigSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true },
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
  hops_path: { type: String, default: 'DIRECT' }, // เส้นทาง Mesh Trace
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
// API Routes
// ==========================================

// 1. รับข้อมูล Telemetry จาก Gateway
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

    const validIdRegex = /^[A-Za-z0-9_-]{3,12}$/;
    if (!device_id || !validIdRegex.test(device_id)) {
      return res.status(400).json({ error: 'Invalid device_id' });
    }

    if (distance_cm === undefined || isNaN(distance_cm)) {
      return res.status(400).json({ error: 'Valid distance_cm is required' });
    }

    // กรองข้อมูลซ้ำในระดับ Server
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

    // โหลดหรือสร้าง Config อุปกรณ์
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
      const tankH = config.tank_height_cm || 83.0;
      calculatedDepth = Math.max(0, Math.round((tankH - rawDist) * 10) / 10);
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

    res.status(201).json({ success: true, message: 'Saved successfully', data: telemetry });
  } catch (err) {
    console.error('Telemetry Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. ดึงรายการจุดวัดพร้อมสถานะล่าสุด
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

// 3. ดึงประวัติย้อนหลังตาม Timeframe
app.get('/api/telemetry/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { timeframe } = req.query;

    let timeLimit = new Date(Date.now() - 24 * 60 * 60 * 1000); // ค่าเริ่มต้น 24h
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
  console.log(`Server listening on port ${PORT}`);
});