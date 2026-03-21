🌊 ระบบติดตามระดับน้ำท่วม (Flood Monitor System)

ระบบ IoT แบบครบวงจรสำหรับการติดตาม แจ้งเตือน และวิเคราะห์ระดับน้ำแบบเรียลไทม์ โดยใช้เทคโนโลยีการสื่อสารระยะไกล (LoRa) ส่งข้อมูลผ่าน Gateway เข้าสู่ระบบ Cloud/Server ส่วนกลาง แสดงผลผ่าน Web Application ที่ทันสมัยและรองรับการใช้งานบนมือถือ (Responsive)

✨ ความสามารถหลัก (Features)

📍 Real-time Dashboard & Map: แสดงจุดวัดระดับน้ำบนแผนที่ (Leaflet) พร้อมคำนวณระยะทางจากผู้ใช้งานไปยังจุดวัดอัตโนมัติ

📊 Historical Data & Charts: แสดงกราฟสถิติระดับน้ำย้อนหลัง (3 ชม., 24 ชม., 7 วัน, 30 วัน หรือระบุวันที่) ด้วย Chart.js

📡 Auto-Discovery Sensors: อุปกรณ์เซ็นเซอร์ใหม่จะปรากฏในระบบโดยอัตโนมัติเมื่อมีการส่งข้อมูลเข้ามาครั้งแรก

🔋 Hardware Monitoring: ตรวจสอบและแสดงระดับแบตเตอรี่ (Battery) และความแรงสัญญาณวิทยุ (RSSI) ของเซ็นเซอร์

⚙️ Admin Management System: - ระบบล็อกอินและจัดการผู้ดูแลระบบ (Session-based Authentication)

จัดการข้อมูลจุดวัด (ตั้งชื่อ, พิกัด, ชนิดของแหล่งน้ำ)

อัปโหลดและครอบตัดรูปภาพจุดวัด (Cropper.js)

ตั้งค่าระยะอ้างอิง (Calibration Offset) และเกณฑ์การแจ้งเตือน (Watch / Critical Thresholds)

🏗️ สถาปัตยกรรมระบบ (System Architecture)

ระบบถูกออกแบบโดยแบ่งการทำงานออกเป็น 3 ส่วนหลัก ได้แก่ Edge (Hardware), Backend (Server), และ Frontend (Web UI)

Edge (Hardware Devices)

LoRa Sender Node (ESP8266 + Ultrasonic): เซ็นเซอร์วัดระยะทางส่งข้อมูลผ่าน LoRa 433MHz

LoRa to MQTT Gateway (ESP8266): รับข้อมูลจาก Sender Node ผ่านความถี่ 433MHz (Long Range Mode: SF12, BW62.5k) จากนั้นแปลงข้อมูลแล้ว Publish เข้าสู่ MQTT Broker ผ่าน WiFi

Backend Services (Dockerized)

MQTT Broker (Eclipse Mosquitto): ทำหน้าที่เป็นตัวกลางรับส่งข้อมูล (Message Broker) ที่พอร์ต 1883

MongoDB: ฐานข้อมูล NoSQL สำหรับเก็บข้อมูลประวัติ (Readings), ตั้งค่าจุดวัด (Sensors), และผู้ใช้งาน (Users)

Ingestion Service (Node.js): Service คอย Subscribe ข้อมูลจาก MQTT (distance, battery, rssi) และบันทึกลงฐานข้อมูล MongoDB แบบอัตโนมัติ

Web API Service (Node.js/Express): REST API Server ทำหน้าที่ให้บริการข้อมูลแก่หน้าเว็บ, จัดการระบบ Login, และอัปโหลดไฟล์รูปภาพ (รันที่พอร์ต 3000)

Frontend (Static Web)

พัฒนาด้วย HTML5, Vanilla JavaScript, และ Tailwind CSS (ผ่าน CDN)

ไม่ต้องใช้กระบวนการ Build (No Webpack/Vite) ทำให้แก้ไขและนำไปใช้งานได้ง่ายและรวดเร็ว

📂 โครงสร้างโฟลเดอร์ (Project Structure)

flood-monitor/
├── docker-compose.yml       # ไฟล์ตั้งค่า Docker (ประกอบด้วย Mongo, Mosquitto, API, Ingestion)
├── Dockerfile               # ไฟล์สร้าง Image สำหรับ Node.js
├── package.json             # รายการ Library ของ Node.js (express, mongodb, mqtt, etc.)
├── mosquitto.conf           # ไฟล์ตั้งค่า MQTT Broker (อนุญาตพอร์ต 1883)
├── ingestion_service.js     # โค้ดส่วนรับข้อมูลจาก MQTT ลง Database
├── web_api_service.js       # โค้ดส่วน Express Web Server และ API
├── lora_gateway_flood.ino   # โค้ด Arduino C++ สำหรับทำ LoRa Gateway
├── check_wifi_rssi.ino      # โค้ดสำหรับทดสอบความแรงสัญญาณ WiFi (Tools)
└── public/                  # โฟลเดอร์เก็บไฟล์เว็บ (Frontend)
    ├── index.html           # หน้าหลัก (Dashboard & Map)
    ├── detail.html          # หน้ารายละเอียดและกราฟจุดวัด
    ├── admin.html           # หน้าจัดการระบบสำหรับผู้ดูแล
    ├── login.html           # หน้าเข้าสู่ระบบ
    ├── about.html           # หน้าเกี่ยวกับระบบ และนโยบายความเป็นส่วนตัว
    ├── icons/               # โฟลเดอร์เก็บไอคอนต่างๆ
    └── uploads/             # โฟลเดอร์เก็บรูปภาพจุดวัดที่อัปโหลด (Auto-generated)


🚀 การติดตั้งและการเริ่มใช้งาน (Getting Started)

ข้อกำหนดเบื้องต้น (Prerequisites)

ติดตั้ง Docker และ Docker Compose บนเครื่อง Server หรือคอมพิวเตอร์ของคุณ

Arduino IDE (สำหรับอัปโหลดโค้ดลง ESP8266)

1. การตั้งค่าฝั่ง Server (Backend & Frontend)

นำไฟล์ทั้งหมดวางไว้ในโฟลเดอร์เดียวกัน (เช่น flood-monitor)

เปิด Terminal ในโฟลเดอร์นั้น แล้วรันคำสั่ง:

docker-compose up -d --build


รอจนกว่าระบบจะสร้างและเริ่มการทำงานของ Container ครบทั้ง 4 ตัว (mongo, mosquitto, web-api, ingestion)

เปิดเบราว์เซอร์แล้วเข้าสู่ http://localhost:3000 (หรือ IP ของเซิร์ฟเวอร์)

2. ข้อมูลสำหรับผู้ดูแลระบบ (Default Admin Account)

เมื่อระบบรันครั้งแรก web_api_service.js จะสร้างบัญชี Admin เริ่มต้นให้โดยอัตโนมัติ:

Email: admin@example.com

Password: password123

คำแนะนำ: เมื่อเข้าสู่ระบบหน้า admin.html ได้แล้ว ให้ทำการสร้างบัญชีผู้ใช้ใหม่ด้วยอีเมลของคุณ จากนั้นลบบัญชีเริ่มต้นนี้ทิ้งเพื่อความปลอดภัย

3. การตั้งค่าฝั่ง Hardware (LoRa Gateway)

เปิดไฟล์ lora_gateway_flood.ino ด้วย Arduino IDE

แก้ไขชื่อ WiFi (ssid) และรหัสผ่าน (password) ให้ตรงกับเครือข่ายที่จะนำไปติดตั้ง

แก้ไข MQTT_SERVER_IP เป็น IP Address ของเครื่อง Server/คอมพิวเตอร์ที่รัน Docker

อัปโหลดโค้ดลงบอร์ด ESP8266 NodeMCU

เมื่อบอร์ดเชื่อมต่อ WiFi สำเร็จ จะส่งข้อมูลเข้าสู่ระบบอัตโนมัติ (ตรวจสอบสถานะได้จากหน้าต่าง Serial Monitor ที่ Baud rate 115200)

📝 รูปแบบข้อมูล MQTT (MQTT Topic Structure)

Gateway จะทำการส่งข้อมูล (Publish) ไปยัง MQTT Broker ภายใต้หัวข้อต่างๆ ดังนี้:

sensors/[SENSOR_ID]/distance : ข้อมูลระยะทาง (เซนติเมตร) เช่น 85

sensors/[SENSOR_ID]/battery : ข้อมูลระดับแรงดันแบตเตอรี่ (โวลต์) เช่น 3.7

sensors/[SENSOR_ID]/rssi : ข้อมูลความแรงของสัญญาณวิทยุ (dBm) เช่น -105

🛠️ เครื่องมือและไลบรารีที่ใช้งาน (Tech Stack)

Backend: Node.js, Express, MQTT.js, MongoDB Native Driver, Multer, Bcrypt.js, Express-session, Connect-mongo

Frontend: HTML5, Tailwind CSS, Chart.js, Chartjs-adapter-date-fns, Leaflet.js, Cropper.js

Database: MongoDB 6.x

Infrastructure: Docker, Docker Compose, Mosquitto MQTT

Hardware: ESP8266, LoRa (Ra-02 / SX1278), PubSubClient

จัดทำขึ้นเพื่อใช้ในการประเมินและติดตามสถานะน้ำท่วม/น้ำรอการระบาย