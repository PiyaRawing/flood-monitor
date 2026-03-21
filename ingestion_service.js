import { MongoClient } from 'mongodb';
import mqtt from 'mqtt';

const mongoUri = `mongodb://root:examplepassword@mongo:27017/?authSource=admin`;
const dbName = 'waterSystemDB';
const client = new MongoClient(mongoUri);
let db;

const mqttBrokerUrl = `mqtt://mosquitto:1883`;
let mqttClient;

function connectMQTT() {
  console.log(`[Ingestion Service] Connecting to MQTT Broker at ${mqttBrokerUrl}...`);
  mqttClient = mqtt.connect(mqttBrokerUrl);

  mqttClient.on('connect', () => {
    console.log(`[Ingestion Service] Connected to MQTT Broker`);
    
    // Subscribe ทุกข้อมูลที่ Gateway ส่งมา
    const topics = [
      'sensors/+/distance',
      'sensors/+/battery',
      'sensors/+/rssi'
    ];
    
    mqttClient.subscribe(topics, (err) => {
      if (!err) {
        console.log(`[Ingestion Service] Subscribed to all sensor topics.`);
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const parts = topic.split('/');
      const sensorId = parts[1];
      const dataType = parts[2]; 
      const rawVal = message.toString();
      const value = parseFloat(rawVal);

      if (isNaN(value)) return;

      const timestamp = new Date();
      console.log(`[Ingestion Service] Received ${dataType} from ${sensorId}: ${value}`);

      let updateDoc = { $set: { lastUpdateISO: timestamp } };
      
      if (dataType === 'distance') {
        // บันทึกประวัติเฉพาะข้อมูลระยะทาง
        await db.collection('readings').insertOne({
          sensorId,
          rawValue: value,
          timestamp
        });
        updateDoc.$set.lastRawValue = value;
      } else if (dataType === 'battery') {
        updateDoc.$set.batteryV = value;
      } else if (dataType === 'rssi') {
        updateDoc.$set.rssi = value;
      }

      // อัปเดตหรือสร้างข้อมูลเซ็นเซอร์ใหม่ (Auto-Discovery)
      await db.collection('sensors').updateOne(
        { sensorId: sensorId },
        { 
          ...updateDoc,
          $setOnInsert: {
            name: `(อุปกรณ์ใหม่: ${sensorId})`,
            location: "N/A",
            type: "N/A",
            calibrationOffset: 200,
            thresholds: { watch: 0.4, critical: 0.8 },
            imageUrl: `https://placehold.co/600x400/e2e8f0/cbd5e1?text=${sensorId}`
          }
        },
        { upsert: true }
      );

    } catch (err) {
      console.error('[Ingestion Service] Error:', err);
    }
  });
}

async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log(`[Ingestion Service] MongoDB Connected`);
    await db.collection('readings').createIndex({ sensorId: 1, timestamp: -1 });
    await db.collection('sensors').createIndex({ sensorId: 1 }, { unique: true });
  } catch (err) {
    console.error("[Ingestion Service] MongoDB Error", err);
    process.exit(1);
  }
}

async function startService() {
  await connectDB();
  connectMQTT();
}

startService();