// ===== Ingestion Service (ส่วนรับข้อมูล) =====
//
// (แก้ไข) ไฟล์นี้กำลังจะรันใน Docker
// ===============================================

import { MongoClient } from 'mongodb';
import mqtt from 'mqtt';

// --- (ลบ) ไม่ต้องใช้ IP ภายนอกอีกต่อไป ---
// const UBUNTU_SERVER_IP = '192.168.68.140';
// ------------------------------------------

// --- Database Config (แก้ไข) ---
// (สำคัญ) เปลี่ยนไปใช้ "ชื่อ Service" ของ Docker
const mongoUri = `mongodb://root:examplepassword@mongo:27017/?authSource=admin`;
const dbName = 'waterSystemDB';
const client = new MongoClient(mongoUri);
let db;

// --- MQTT Config (แก้ไข) ---
// (สำคัญ) เปลี่ยนไปใช้ "ชื่อ Service" ของ Docker
const mqttBrokerUrl = `mqtt://mosquitto:1883`;
let mqttClient;


// --- ฟังก์ชันเชื่อมต่อ MQTT Broker ---
function connectMQTT() {
  console.log(`[Ingestion Service] Connecting to MQTT Broker at ${mqttBrokerUrl}...`);
  mqttClient = mqtt.connect(mqttBrokerUrl);

  mqttClient.on('connect', () => {
    console.log(`[Ingestion Service] Connected to MQTT Broker at ${mqttBrokerUrl}`);
    
    // (แก้ไข) -----------------------------------------
    // const topic = 'sensors/+/data'; // (ของเก่า)
    const topic = 'sensors/+/distance'; // (สำคัญ) แก้ไขให้ตรงกับที่ ESP ส่งมา
    // -------------------------------------------------
    
    mqttClient.subscribe(topic, (err) => {
      if (!err) {
        console.log(`[Ingestion Service] Subscribed to topic "${topic}"`);
      } else {
        console.error(`[Ingestion Service] MQTT Subscribe error: ${err}`);
      }
    });
  });

  // (สำคัญ) เมื่อมีข้อความ (ข้อมูลดิบ) ส่งมาจาก ESP8266
  mqttClient.on('message', async (topic, message) => {
    try {
      const sensorId = topic.split('/')[1];
      const rawValue = parseFloat(message.toString());

      if (isNaN(rawValue)) {
        console.error(`[Ingestion Service] Received invalid data from ${topic}: ${message.toString()}`);
        return;
      }

      console.log(`[Ingestion Service] Received MQTT message from topic ${topic}: ${rawValue}`);

      // 1. สร้างข้อมูลดิบ (Reading)
      const newReading = {
        sensorId: sensorId,
        rawValue: rawValue,
        timestamp: new Date()
      };

      // 2. บันทึกข้อมูลดิบลง Collection "readings"
      await db.collection('readings').insertOne(newReading);

      // 3. (Auto-Discovery) สร้าง/อัปเดต Config ใน Collection "sensors" อัตโนมัติ
      const filter = { sensorId: sensorId };
      const updateDoc = {
        $set: {
          lastUpdateISO: newReading.timestamp
        },
        $setOnInsert: {
          // (แก้ไข Bug) ย้าย name, location, type มาไว้ที่นี่
          // ข้อมูลเหล่านี้จะถูก "สร้าง" แค่ครั้งแรก
          name: `(เซ็นเซอร์ใหม่: ${sensorId})`,
          location: "N/A",
          type: "N/A",
          imageUrl: `https://placehold.co/600x400/e2e8f0/cbd5e1?text=${sensorId}`,
          calibrationOffset: 200, // (แก้ไข) ตั้งค่า Offset เริ่มต้นที่ 200 (หรือค่าที่คุณต้องการ)
          thresholds: {
            watch: 0.4,
            critical: 0.8
          }
        }
      };
      await db.collection('sensors').updateOne(filter, updateDoc, { upsert: true });

    } catch (err) {
      console.error('[Ingestion Service] Error processing MQTT message:', err);
    }
  });

  mqttClient.on('error', (err) => {
    console.error(`[Ingestion Service] MQTT Connection error: ${err}`);
  });

  mqttClient.on('close', () => {
    console.log('[Ingestion Service] MQTT connection closed. Reconnecting...');
    // (ควรเพิ่ม Logic พยายามเชื่อมต่อใหม่ใน Production)
  });
}


// --- ฟังก์ชันเชื่อมต่อ Database ---
async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    // (แก้ไข) Log
    console.log(`[Ingestion Service] Connected successfully to MongoDB at mongo:27017`);
    
    // (สำคัญ) Service นี้เป็นคน "เขียน" จึงต้องรับผิดชอบการสร้าง Index
    await db.collection('readings').createIndex({ sensorId: 1, timestamp: -1 });
    await db.collection('sensors').createIndex({ sensorId: 1 }, { unique: true });

  } catch (err) {
    console.error("[Ingestion Service] Could not connect to MongoDB", err);
    process.exit(1); // ออกจากโปรแกรมถ้าต่อ DB ไม่ได้
  }
}

// --- เริ่มการทำงานของ Service ---
async function startService() {
  console.log("Starting Ingestion Service...");
  // 1. (สำคัญ) เชื่อมต่อ Database ก่อน
  await connectDB();
  
  // 2. เชื่อมต่อ MQTT Broker
  connectMQTT();
}

// สั่งให้ Service เริ่มทำงาน
startService();